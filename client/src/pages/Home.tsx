import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Database, FileText, Network, GitBranch, MessageSquare,
  Activity, Loader2, TrendingUp,
} from "lucide-react";

function StatCard({
  title, value, subtitle, icon: Icon, color,
}: {
  title: string; value: string | number; subtitle?: string;
  icon: React.ElementType; color: string;
}) {
  return (
    <Card className="glass-card border-border/50">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {title}
            </p>
            <p className="text-2xl font-bold text-foreground">{value}</p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div className={`p-2.5 rounded-lg ${color}`}>
            <Icon className="h-5 w-5 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const { data: stats, isLoading } = trpc.dashboard.stats.useQuery();
  const { data: logs } = trpc.dashboard.recentLogs.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const s = stats || {
    datasets: 0, resources: 0, documents: 0,
    entities: 0, relationships: 0, communities: 0, queries: 0,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          <span className="text-gradient-orange">Dashboard</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Visão geral da plataforma GraphRAG para precedentes do STJ
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Datasets STJ"
          value={s.datasets}
          subtitle={`${s.resources} recursos disponíveis`}
          icon={Database}
          color="gradient-orange"
        />
        <StatCard
          title="Documentos"
          value={s.documents}
          subtitle="Documentos carregados"
          icon={FileText}
          color="bg-blue-600"
        />
        <StatCard
          title="Entidades no Grafo"
          value={s.entities}
          subtitle={`${s.relationships} relações`}
          icon={Network}
          color="bg-emerald-600"
        />
        <StatCard
          title="Consultas RAG"
          value={s.queries}
          subtitle={`${s.communities} comunidades`}
          icon={MessageSquare}
          color="bg-purple-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pipeline Status */}
        <Card className="glass-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Pipeline GraphRAG
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <PipelineStep
              step="1"
              label="Extração de Dados (API CKAN)"
              description="Sincronizar datasets do portal de dados abertos do STJ"
              status={s.datasets > 0 ? "done" : "pending"}
            />
            <PipelineStep
              step="2"
              label="Processamento & Chunking"
              description="Extrair campos relevantes e dividir em chunks semânticos"
              status={s.resources > 0 ? "done" : "pending"}
            />
            <PipelineStep
              step="3"
              label="Extração de Entidades"
              description="Identificar ministros, processos, temas, legislação via LLM"
              status={s.entities > 0 ? "done" : "pending"}
            />
            <PipelineStep
              step="4"
              label="Construção do Grafo"
              description="Criar relações entre entidades e detectar comunidades"
              status={s.communities > 0 ? "done" : "pending"}
            />
            <PipelineStep
              step="5"
              label="Geração de Embeddings"
              description="Vetorizar chunks e armazenar no Qdrant"
              status={s.resources > 0 ? "done" : "pending"}
            />
            <PipelineStep
              step="6"
              label="Consulta GraphRAG"
              description="Busca local (entidades) + global (comunidades) + vetorial"
              status="ready"
            />
          </CardContent>
        </Card>

        {/* Recent Activity */}
        <Card className="glass-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Atividade Recente
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!logs || logs.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                Nenhuma atividade registada. Inicie sincronizando os datasets do STJ.
              </p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {logs.slice(0, 15).map((log) => (
                  <div
                    key={log.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/30 transition-colors"
                  >
                    <Badge
                      variant={
                        log.status === "completed"
                          ? "default"
                          : log.status === "failed"
                          ? "destructive"
                          : "secondary"
                      }
                      className="text-[10px] w-20 justify-center shrink-0"
                    >
                      {log.status}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">
                        {log.action.replace(/_/g, " ")}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {log.details || "-"}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {log.durationMs ? `${(log.durationMs / 1000).toFixed(1)}s` : "-"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PipelineStep({
  step, label, description, status,
}: {
  step: string; label: string; description: string;
  status: "done" | "pending" | "ready";
}) {
  return (
    <div className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-accent/20 transition-colors">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
          status === "done"
            ? "gradient-orange text-white"
            : status === "ready"
            ? "bg-emerald-600 text-white"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {step}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Badge
        variant={status === "done" ? "default" : "secondary"}
        className="text-[10px] shrink-0 ml-auto"
      >
        {status === "done" ? "Concluído" : status === "ready" ? "Pronto" : "Pendente"}
      </Badge>
    </div>
  );
}
