import { useCallback, useRef } from "react";
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react";
import type * as MonacoEditor from "monaco-editor";

const OFFSET_TYPES_URI = "file:///ghostping/offset-types.d.ts";
const OFFSET_MODEL_URI = "file:///ghostping/offset.fn.js";
const FORMAT_MARKER_OWNER = "ghostping-format";

const OFFSET_TYPE_DEFS = `
declare namespace GhostPing {
  interface DescriptionObject {
    text?: string;
    color?: string;
    bold?: boolean;
    italic?: boolean;
    underlined?: boolean;
  }

  type DescriptionPart = string | DescriptionObject;

  interface PlayerSample {
    name: string;
    id?: string;
  }

  interface ServerVersion {
    name?: string;
    protocol?: number;
  }

  interface ServerPlayers {
    online?: number;
    max?: number;
    sample?: PlayerSample[];
  }

  interface ServerStatus {
    version?: ServerVersion;
    favicon?: string;
    description?: DescriptionPart[] | { text?: string } | string;
    players?: ServerPlayers;
    [key: string]: unknown;
  }

  type OffsetResult = Partial<ServerStatus> | void;
  type OffsetFunction = (
    origin: ServerStatus,
    servers: ServerStatus[],
  ) => OffsetResult;
}
`;

export const OFFSET_FUNCTION_TYPE_HEADER = "/** @type {GhostPing.OffsetFunction} */";

export function ensureOffsetTypedSource(source: string) {
  if (source.includes("GhostPing.OffsetFunction")) {
    return source;
  }
  if (!source.trim()) {
    return `${OFFSET_FUNCTION_TYPE_HEADER}
export default (origin, servers) => ({
  players: {
    online: origin.players?.online ?? 0,
    max: origin.players?.max ?? 0,
  },
});
`;
  }
  return `${OFFSET_FUNCTION_TYPE_HEADER}
${source}`;
}

export type OffsetFunctionEditorHandle = {
  format: () => Promise<void>;
};

type OffsetFunctionEditorProps = {
  value: string;
  onChange: (value: string) => void;
  dark: boolean;
  onReady?: (handle: OffsetFunctionEditorHandle) => void;
  onSaveShortcut?: (value: string) => void;
};

let hasConfiguredMonaco = false;

function configureMonaco(monaco: Monaco) {
  if (hasConfiguredMonaco) {
    return;
  }

  monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    allowJs: true,
    checkJs: true,
    allowNonTsExtensions: true,
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
  });
  monaco.languages.typescript.javascriptDefaults.addExtraLib(
    OFFSET_TYPE_DEFS,
    OFFSET_TYPES_URI,
  );

  hasConfiguredMonaco = true;
}

export function OffsetFunctionEditor({
  value,
  onChange,
  dark,
  onReady,
  onSaveShortcut,
}: OffsetFunctionEditorProps) {
  const editorRef = useRef<MonacoEditor.editor.IStandaloneCodeEditor | null>(null);

  const handleBeforeMount = useCallback((monaco: Monaco) => {
    configureMonaco(monaco);
  }, []);

  const handleMount: OnMount = useCallback(
    (
      editor: MonacoEditor.editor.IStandaloneCodeEditor,
      monaco: Monaco,
    ) => {
      editorRef.current = editor;

      const setFormatErrorMarker = (message: string) => {
        const model = editor.getModel();
        if (!model) {
          return;
        }
        const position = editor.getPosition() ?? { lineNumber: 1, column: 1 };
        monaco.editor.setModelMarkers(model, FORMAT_MARKER_OWNER, [
          {
            severity: monaco.MarkerSeverity.Warning,
            message,
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column + 1,
          },
        ]);
      };

      const clearFormatErrorMarker = () => {
        const model = editor.getModel();
        if (!model) {
          return;
        }
        monaco.editor.setModelMarkers(model, FORMAT_MARKER_OWNER, []);
      };

      editor.addAction({
        id: "ghostping.apply-offset",
        label: "Apply Offset Function",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => {
          onSaveShortcut?.(editor.getValue());
        },
      });

      onReady?.({
        format: async () => {
          const action = editor.getAction("editor.action.formatDocument");
          if (!action) {
            const message = "Monaco 格式化器未就绪";
            setFormatErrorMarker(message);
            throw new Error(message);
          }
          try {
            await action.run();
            clearFormatErrorMarker();
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "格式化执行失败";
            setFormatErrorMarker(message);
            throw new Error(message);
          }
        },
      });
    },
    [onReady, onSaveShortcut],
  );

  return (
    <div className="overflow-visible rounded-md border border-[hsl(var(--input))]">
      <Editor
        path={OFFSET_MODEL_URI}
        language="javascript"
        value={value}
        onChange={(next: string | undefined) => onChange(next ?? "")}
        beforeMount={handleBeforeMount}
        onMount={handleMount}
        height="340px"
        theme={dark ? "vs-dark" : "vs"}
        options={{
          automaticLayout: true,
          fixedOverflowWidgets: true,
          minimap: { enabled: false },
          fontSize: 13,
          tabSize: 2,
          insertSpaces: true,
          scrollBeyondLastLine: false,
          lineNumbersMinChars: 3,
          wordWrap: "on",
          formatOnPaste: true,
          formatOnType: true,
          quickSuggestions: {
            comments: false,
            strings: true,
            other: true,
          },
          suggestOnTriggerCharacters: true,
          bracketPairColorization: { enabled: true },
          padding: { top: 12, bottom: 12 },
        }}
      />
    </div>
  );
}
