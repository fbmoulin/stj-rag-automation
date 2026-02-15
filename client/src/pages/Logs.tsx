import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollText, Loader2, Clock, AlertCircle, CheckCircle2 } from "lucide-react";

export default function Logs() {
  const { data: logs, isLoading } = trpc.dashboard.recentLogs.useQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="text-gradient-orange">Logs & Auditoria</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Histórico de extrações, processamentos e consultas (Resolução CNJ 615/2025)
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !logs || logs.length === 0 ? (
        <Card className="glass-card border-border/50">
          <CardContent className="py-12 text-center">
            <ScrollText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Nenhum log registado. As atividades serão registadas automaticamente.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="glass-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-primary" />
              Registos de Atividade ({logs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {logs.map((log: any) => (
                <LogEntry key={log.id} log={log} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LogEntry({ log }: { log: any }) {
  const statusIcon =
    log.status === "completed" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
    ) : log.status === "failed" ? (
      <AlertCircle className="h-4 w-4 text-destructive" />
    ) : (
      <Clock className="h-4 w-4 text-yellow-400" />
    );

  const actionLabels: Record<string, string> = {
    sync_datasets: "Sincronizar Datasets",
    download_resource: "Download Recurso",
    process_json: "Processar JSON",
    extract_entities: "Extrair Entidades",
    build_communities: "Construir Comunidades",
    generate_embeddings: "Gerar Embeddings",
    upload_document: "Upload Documento",
    process_document: "Processar Documento",
    rag_query: "Consulta RAG",
  };

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-accent/20 hover:bg-accent/30 transition-colors">
      <div className="shrink-0 mt-0.5">{statusIcon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-sm font-medium">
            {actionLabels[log.action] || log.action}
          </p>
          <Badge
            variant={
              log.status === "completed"
                ? "default"
                : log.status === "failed"
                ? "destructive"
                : "secondary"
            }
            className="text-[10px]"
          >
            {log.status}
          </Badge>
        </div>
        {log.details && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-1">
            {log.details}
          </p>
        )}
        <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
          {log.recordsProcessed != null && (
            <span>Registos: {log.recordsProcessed}</span>
          )}
          {log.chunksGenerated != null && (
            <span>Chunks: {log.chunksGenerated}</span>
          )}
          {log.entitiesExtracted != null && (
            <span>Entidades: {log.entitiesExtracted}</span>
          )}
          {log.relationshipsExtracted != null && (
            <span>Relações: {log.relationshipsExtracted}</span>
          )}
          {log.embeddingsGenerated != null && (
            <span>Embeddings: {log.embeddingsGenerated}</span>
          )}
          {log.durationMs != null && (
            <span>Duração: {(log.durationMs / 1000).toFixed(1)}s</span>
          )}
          {log.errorMessage && (
            <span className="text-destructive">Erro: {log.errorMessage}</span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground/60 mt-1">
          {new Date(log.createdAt).toLocaleString("pt-BR")}
        </p>
      </div>
    </div>
  );
}
