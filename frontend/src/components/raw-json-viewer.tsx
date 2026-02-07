import { useCallback, useEffect, useMemo, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type * as MonacoEditor from "monaco-editor";

const RAW_JSON_MODEL_URI = "file:///ghostping/raw-json-viewer.json";

type RawJsonViewerProps = {
  value: string;
  dark: boolean;
};

function toDisplayJson(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    const normalized = normalizeFavicon(parsed);
    return JSON.stringify(normalized, null, 2);
  } catch {
    return value;
  }
}

function normalizeFavicon(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeFavicon(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(input)) {
    if (key === "favicon" && typeof raw === "string") {
      const mimeMatch = /^data:([^;]+);base64,/.exec(raw);
      output[key] = {
        __collapsed__: true,
        mime: mimeMatch?.[1] ?? "unknown",
        length: raw.length,
        preview: `${raw.slice(0, 64)}...`,
        data: raw,
      };
      continue;
    }
    output[key] = normalizeFavicon(raw);
  }

  return output;
}

export function RawJsonViewer({ value, dark }: RawJsonViewerProps) {
  const editorRef = useRef<MonacoEditor.editor.IStandaloneCodeEditor | null>(null);
  const displayValue = useMemo(() => toDisplayJson(value), [value]);

  const foldFavicon = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const model = editor.getModel();
    if (!model) {
      return;
    }

    const lineCount = model.getLineCount();
    for (let line = 1; line <= lineCount; line += 1) {
      const text = model.getLineContent(line).trimStart();
      if (text.startsWith('"favicon": {')) {
        editor.setPosition({ lineNumber: line, column: 1 });
        void editor.getAction("editor.fold")?.run();
        break;
      }
    }
  }, []);

  const handleMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    foldFavicon();
  }, [foldFavicon]);

  useEffect(() => {
    foldFavicon();
  }, [displayValue, foldFavicon]);

  return (
    <div className="w-full min-w-0 overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50">
      <Editor
        path={RAW_JSON_MODEL_URI}
        language="json"
        value={displayValue}
        onMount={handleMount}
        onChange={() => {
          // readOnly viewer; keep uncontrolled edits disabled
        }}
        width="100%"
        height="48vh"
        theme={dark ? "vs-dark" : "vs"}
        options={{
          readOnly: true,
          domReadOnly: true,
          minimap: { enabled: false },
          lineNumbersMinChars: 3,
          folding: true,
          foldingStrategy: "indentation",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          fixedOverflowWidgets: true,
          wordWrap: "on",
          tabSize: 2,
          stickyScroll: {
            enabled: false,
          },
          glyphMargin: false,
        }}
      />
    </div>
  );
}
