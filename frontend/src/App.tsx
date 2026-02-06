import { useEffect, useMemo, useRef, useState } from "react";
import {
  Clipboard,
  Code2,
  FileCode2,
  LoaderCircle,
  Moon,
  RefreshCcw,
  Sun,
  Upload,
} from "lucide-react";
import { getOffsetFn, getServerList, loadDemoFn, putOffsetFn } from "@/api";
import type { DescriptionPart, ServerStatus } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ensureOffsetTypedSource,
  OffsetFunctionEditor,
  type OffsetFunctionEditorHandle,
} from "@/components/offset-function-editor";

const COLOR_MAP: Record<string, string> = {
  black: "#000000",
  dark_blue: "#0000AA",
  dark_green: "#00AA00",
  dark_aqua: "#00AAAA",
  dark_red: "#AA0000",
  dark_purple: "#AA00AA",
  gold: "#FFAA00",
  gray: "#AAAAAA",
  dark_gray: "#555555",
  blue: "#5555FF",
  green: "#55FF55",
  aqua: "#55FFFF",
  red: "#FF5555",
  light_purple: "#FF55FF",
  yellow: "#FFFF55",
  white: "#FFFFFF",
};

function StatusBar({ text, tone }: { text: string; tone: "info" | "error" | "success" }) {
  const color =
    tone === "error"
      ? "text-red-500"
      : tone === "success"
        ? "text-emerald-500"
        : "text-[hsl(var(--muted-foreground))]";
  return <p className={`text-sm ${color}`}>{text}</p>;
}

export default function App() {
  const [source, setSource] = useState(() => ensureOffsetTypedSource(""));
  const [serverData, setServerData] = useState<ServerStatus | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [themeDark, setThemeDark] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: "info" | "error" | "success" }>({
    text: "",
    tone: "info",
  });
  const [loading, setLoading] = useState({
    refresh: false,
    apply: false,
    load: false,
    demo: false,
  });
  const editorHandleRef = useRef<OffsetFunctionEditorHandle | null>(null);

  useEffect(() => {
    const isDark =
      localStorage.theme === "dark" ||
      (!("theme" in localStorage) &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
    setThemeDark(isDark);
  }, []);

  useEffect(() => {
    void handleLoadCurrent();
    void handleRefresh();
  }, []);

  const rawJson = useMemo(() => JSON.stringify(serverData ?? {}, null, 2), [serverData]);

  function setFeedback(text: string, tone: "info" | "error" | "success" = "info") {
    setStatus({ text, tone });
    if (tone === "success") {
      window.setTimeout(() => {
        setStatus((old) => (old.text === text ? { text: "", tone: "info" } : old));
      }, 2500);
    }
  }

  function toggleTheme() {
    const next = !themeDark;
    setThemeDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.theme = next ? "dark" : "light";
  }

  async function handleLoadCurrent() {
    setLoading((v) => ({ ...v, load: true }));
    try {
      const data = await getOffsetFn();
      setSource(ensureOffsetTypedSource(data.__fn__ ?? ""));
      setFeedback("已同步服务器函数", "success");
    } catch (error) {
      setFeedback(`加载失败: ${String(error)}`, "error");
    } finally {
      setLoading((v) => ({ ...v, load: false }));
    }
  }

  async function handleApply() {
    await applySource(source);
  }

  async function handleFormat() {
    if (!editorHandleRef.current) {
      setFeedback("编辑器尚未就绪", "error");
      return;
    }
    try {
      await editorHandleRef.current.format();
      setFeedback("代码已格式化", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setFeedback(`格式化失败: ${message}`, "error");
    }
  }

  async function applySource(nextSource: string) {
    const value = nextSource.trim();
    if (!value) {
      setFeedback("函数内容不能为空", "error");
      return;
    }
    setLoading((v) => ({ ...v, apply: true }));
    try {
      await putOffsetFn(value);
      setFeedback("函数已生效", "success");
      await handleRefresh();
    } catch (error) {
      setFeedback(`提交失败: ${String(error)}`, "error");
    } finally {
      setLoading((v) => ({ ...v, apply: false }));
    }
  }

  async function handleLoadDemo() {
    setLoading((v) => ({ ...v, demo: true }));
    try {
      const data = await loadDemoFn();
      setSource(ensureOffsetTypedSource(data.__fn__ ?? ""));
      setFeedback("示例函数已导入", "success");
    } catch (error) {
      setFeedback(`示例导入失败: ${String(error)}`, "error");
    } finally {
      setLoading((v) => ({ ...v, demo: false }));
    }
  }

  async function handleRefresh() {
    setLoading((v) => ({ ...v, refresh: true }));
    try {
      const data = await getServerList();
      setServerData(data);
      setFeedback("预览已刷新", "success");
    } catch (error) {
      setFeedback(`刷新失败: ${String(error)}`, "error");
    } finally {
      setLoading((v) => ({ ...v, refresh: false }));
    }
  }

  async function copyRaw() {
    try {
      await navigator.clipboard.writeText(rawJson);
      setFeedback("JSON 已复制", "success");
    } catch (error) {
      setFeedback(`复制失败: ${String(error)}`, "error");
    }
  }

  function renderDescription(description: ServerStatus["description"]) {
    if (!description) {
      return null;
    }
    if (typeof description === "string") {
      return <span>{description}</span>;
    }
    if (Array.isArray(description)) {
      return description.map((part: DescriptionPart, idx) => {
        if (typeof part === "string") {
          return <span key={`${part}-${idx}`}>{part}</span>;
        }
        const style = {
          color: part.color ? (COLOR_MAP[part.color] ?? part.color) : undefined,
          fontWeight: part.bold ? 700 : 400,
          fontStyle: part.italic ? "italic" : "normal",
          textDecoration: part.underlined ? "underline" : "none",
        };
        return (
          <span key={`part-${idx}`} style={style}>
            {part.text ?? ""}
          </span>
        );
      });
    }
    return <span>{description.text ?? ""}</span>;
  }

  const samplePlayers = serverData?.players?.sample?.slice(0, 6) ?? [];

  return (
    <div className="relative min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <header className="relative z-10 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[hsl(var(--primary))] text-xs font-bold text-[hsl(var(--primary-foreground))]">
              GP
            </div>
            <h1 className="text-lg font-semibold tracking-tight">Ghost Ping Console</h1>
          </div>
          <Button variant="ghost" size="icon" onClick={toggleTheme}>
            {themeDark ? <Sun size={18} /> : <Moon size={18} />}
          </Button>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
        <div className="mb-8">
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Minecraft 服务端控制台</h2>
          <p className="mt-2 text-[hsl(var(--muted-foreground))]">
            编写偏移函数并实时预览客户端展示效果。
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>偏移函数</CardTitle>
                <Badge>Function Mode</Badge>
              </div>
              <CardDescription>传入 origin 与 servers，返回需要覆盖的字段。</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-3 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={handleLoadCurrent} disabled={loading.load}>
                  <Upload size={14} />
                  同步服务端
                </Button>
                <Button size="sm" variant="outline" onClick={handleLoadDemo} disabled={loading.demo}>
                  <Code2 size={14} />
                  导入示例
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void handleFormat();
                  }}
                >
                  <FileCode2 size={14} />
                  格式化
                </Button>
              </div>
              <OffsetFunctionEditor
                value={source}
                onChange={setSource}
                dark={themeDark}
                onSaveShortcut={(latestSource) => {
                  setSource(latestSource);
                  void applySource(latestSource);
                }}
                onReady={(handle) => {
                  editorHandleRef.current = handle;
                }}
              />
              <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                VS Code 编辑器已启用，支持 JS 智能提示、类型检查与格式化。
              </p>
              <div className="mt-4 flex items-center justify-between gap-3">
                <StatusBar text={status.text} tone={status.tone} />
                <Button onClick={handleApply} disabled={loading.apply}>
                  {loading.apply ? <LoaderCircle className="animate-spin" size={16} /> : null}
                  应用函数
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>预览效果</CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="icon" onClick={handleRefresh} disabled={loading.refresh}>
                    <RefreshCcw className={loading.refresh ? "animate-spin" : ""} size={14} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRawOpen(true)}>
                    查看 JSON
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border border-white/10 bg-[#121212] p-4 text-[#AAAAAA] shadow-inner">
                <div className="flex gap-4">
                  <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded border border-white/10 bg-[#1e1e1e]">
                    {serverData?.favicon ? (
                      <img alt="server icon" src={serverData.favicon} className="h-16 w-16 object-contain" />
                    ) : (
                      <span className="text-xs text-[#555555]">N/A</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-4">
                      <h4 className="truncate text-base font-bold text-white">
                        {serverData?.version?.name ?? "Loading..."}
                      </h4>
                      <span className="shrink-0 font-mono text-sm">
                        {serverData?.players?.online ?? 0} / {serverData?.players?.max ?? 0}
                      </span>
                    </div>
                    <div className="mt-1 min-h-10 whitespace-pre-line break-words font-mono text-sm leading-snug">
                      {renderDescription(serverData?.description)}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-[#555555]">
                        Protocol: {serverData?.version?.protocol ?? "-"}
                      </span>
                    </div>
                  </div>
                </div>

                <Separator className="my-3 bg-white/10" />
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#555555]">
                  Sample Players
                </p>
                <div className="space-y-1 pl-1 font-mono text-xs">
                  {samplePlayers.length ? (
                    samplePlayers.map((player) => <div key={player.id ?? player.name}>{" > "}{player.name}</div>)
                  ) : (
                    <div>暂无示例玩家</div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>

      {rawOpen ? (
        <div
          className="fixed inset-0 z-30 grid place-items-center bg-black/45 p-4 backdrop-blur-[2px]"
          onClick={() => setRawOpen(false)}
        >
          <Card
            className="w-full max-w-3xl"
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <CardHeader>
              <CardTitle>原始 JSON</CardTitle>
              <CardDescription>服务端返回的完整数据</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="max-h-[48vh] overflow-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 p-4 font-mono text-xs">
                {rawJson}
              </pre>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setRawOpen(false)}>
                  关闭
                </Button>
                <Button onClick={copyRaw}>
                  <Clipboard size={14} />
                  复制
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
