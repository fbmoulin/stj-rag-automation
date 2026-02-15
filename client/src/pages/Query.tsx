import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import {
  MessageSquare, Send, Loader2, Network, Users, FileText,
  Clock, Copy, Download, ChevronDown, ChevronUp,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface QueryResult {
  answer: string;
  queryType: "local" | "global" | "hybrid";
  entities: { name: string; type: string; description: string }[];
  communityReports: { title: string; summary: string }[];
  vectorResults: { text: string; score: number; source: string }[];
  reasoningChain: string;
  queryId: number;
}

export default function Query() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<QueryResult[]>([]);
  const { data: history } = trpc.rag.history.useQuery();
  const queryMutation = trpc.rag.query.useMutation({
    onSuccess: (data) => {
      setResults((prev) => [data, ...prev]);
      setQuery("");
    },
    onError: (e) => toast.error(`Erro: ${e.message}`),
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    if (!query.trim() || query.trim().length < 3) {
      toast.error("A consulta deve ter pelo menos 3 caracteres.");
      return;
    }
    queryMutation.mutate({ query: query.trim() });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copiado!");
  };

  const exportResult = (result: QueryResult, format: "txt" | "md" | "json") => {
    let content: string;
    let mime: string;
    if (format === "json") {
      content = JSON.stringify(result, null, 2);
      mime = "application/json";
    } else if (format === "md") {
      content = `# Consulta GraphRAG\n\n**Pergunta:** ${query}\n\n**Tipo:** ${result.queryType}\n\n## Resposta\n\n${result.answer}\n\n## Entidades\n\n${result.entities.map(e => `- **${e.name}** (${e.type}): ${e.description}`).join("\n")}\n`;
      mime = "text/markdown";
    } else {
      content = `Consulta: ${query}\nTipo: ${result.queryType}\n\nResposta:\n${result.answer}`;
      mime = "text/plain";
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `graphrag-result.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="text-gradient-orange">Consulta GraphRAG</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Faça perguntas sobre jurisprudência do STJ usando busca local (entidades) e global (comunidades)
        </p>
      </div>

      {/* Query Input */}
      <Card className="glass-card border-border/50">
        <CardContent className="p-4">
          <div className="space-y-3">
            <Textarea
              ref={textareaRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ex: Qual o entendimento do STJ sobre responsabilidade civil em acidentes de trânsito?"
              className="bg-accent/30 border-border/50 min-h-[80px] resize-none"
              disabled={queryMutation.isPending}
            />
            <div className="flex items-center justify-between">
              <div className="flex gap-2 text-[10px] text-muted-foreground">
                <Badge variant="secondary" className="text-[10px]">Local: entidades</Badge>
                <Badge variant="secondary" className="text-[10px]">Global: comunidades</Badge>
                <Badge variant="secondary" className="text-[10px]">Vetorial: embeddings</Badge>
              </div>
              <Button
                onClick={handleSubmit}
                disabled={queryMutation.isPending || query.trim().length < 3}
                className="gradient-orange text-white"
              >
                {queryMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Consultar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {results.map((result, idx) => (
        <ResultCard
          key={idx}
          result={result}
          onCopy={copyToClipboard}
          onExport={exportResult}
        />
      ))}

      {/* History */}
      {history && history.length > 0 && results.length === 0 && (
        <Card className="glass-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Histórico de Consultas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {history.slice(0, 10).map((h: any) => (
              <div
                key={h.id}
                className="flex items-center gap-3 p-2.5 rounded-lg bg-accent/20 hover:bg-accent/30 transition-colors cursor-pointer"
                onClick={() => setQuery(h.query)}
              >
                <MessageSquare className="h-4 w-4 text-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{h.query}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {h.queryType || "hybrid"} | {h.durationMs ? `${(h.durationMs / 1000).toFixed(1)}s` : "-"}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ResultCard({
  result,
  onCopy,
  onExport,
}: {
  result: QueryResult;
  onCopy: (text: string) => void;
  onExport: (result: QueryResult, format: "txt" | "md" | "json") => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  const typeLabel: Record<string, string> = {
    local: "Busca Local (Entidades)",
    global: "Busca Global (Comunidades)",
    hybrid: "Busca Híbrida",
  };

  return (
    <Card className="glass-card border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge className="gradient-orange text-white text-[10px]">
              {typeLabel[result.queryType] || result.queryType}
            </Badge>
            {result.entities.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                <Network className="h-3 w-3 mr-1" />
                {result.entities.length} entidades
              </Badge>
            )}
            {result.communityReports.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                <Users className="h-3 w-3 mr-1" />
                {result.communityReports.length} comunidades
              </Badge>
            )}
            {result.vectorResults.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                <FileText className="h-3 w-3 mr-1" />
                {result.vectorResults.length} chunks
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onCopy(result.answer)}
              className="h-7 w-7 p-0"
            >
              <Copy className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onExport(result, "md")}
              className="h-7 w-7 p-0"
            >
              <Download className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Answer */}
        <div className="prose prose-invert prose-sm max-w-none">
          <Streamdown>{result.answer}</Streamdown>
        </div>

        {/* Toggle Details */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowDetails(!showDetails)}
          className="text-xs text-muted-foreground"
        >
          {showDetails ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
          {showDetails ? "Ocultar detalhes" : "Ver detalhes (entidades, fontes, raciocínio)"}
        </Button>

        {showDetails && (
          <div className="space-y-4 pt-2 border-t border-border/30">
            {/* Entities */}
            {result.entities.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Entidades Encontradas
                </p>
                <div className="flex flex-wrap gap-2">
                  {result.entities.slice(0, 15).map((e, i) => (
                    <Badge key={i} variant="secondary" className="text-[10px]">
                      {e.name} ({e.type})
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Community Reports */}
            {result.communityReports.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Relatórios de Comunidade
                </p>
                {result.communityReports.slice(0, 5).map((c, i) => (
                  <div key={i} className="p-2 rounded bg-accent/20 mb-1">
                    <p className="text-xs font-medium">{c.title}</p>
                    <p className="text-[10px] text-muted-foreground line-clamp-2">{c.summary}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Reasoning Chain */}
            {result.reasoningChain && (
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Cadeia de Raciocínio (Auditoria)
                </p>
                <pre className="text-[10px] text-muted-foreground bg-accent/20 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">
                  {result.reasoningChain}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
