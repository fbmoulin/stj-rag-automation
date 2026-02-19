import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Database, RefreshCw, Cog, Loader2, ChevronDown, ChevronUp,
} from "lucide-react";
import { useState } from "react";

export default function Datasets() {
  const { data: datasets, isLoading, refetch } = trpc.datasets.list.useQuery();
  const syncMutation = trpc.datasets.sync.useMutation({
    onSuccess: () => {
      toast.success("Datasets sincronizados com sucesso!");
      refetch();
    },
    onError: (e) => toast.error(`Erro ao sincronizar: ${e.message}`),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-gradient-orange">Datasets STJ</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Datasets do portal de dados abertos do STJ com recursos JSON
          </p>
        </div>
        <Button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="gradient-orange text-white"
        >
          {syncMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Sincronizar
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !datasets || datasets.length === 0 ? (
        <Card className="glass-card border-border/50">
          <CardContent className="py-12 text-center">
            <Database className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Nenhum dataset encontrado. Clique em "Sincronizar" para buscar os datasets do STJ.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {datasets.map((ds: any) => (
            <DatasetCard key={ds.slug || ds.id} dataset={ds} />
          ))}
        </div>
      )}
    </div>
  );
}

function DatasetCard({ dataset }: { dataset: any }) {
  const [expanded, setExpanded] = useState(false);
  const { data: details } = trpc.datasets.getBySlug.useQuery(
    { slug: dataset.slug },
    { enabled: expanded }
  );

  return (
    <Card className="glass-card border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="space-y-1 min-w-0 flex-1">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Database className="h-4 w-4 text-primary shrink-0" />
              <span className="truncate">{dataset.title}</span>
            </CardTitle>
            {dataset.description && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {dataset.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            {dataset.category && (
              <Badge variant="secondary" className="text-[10px]">
                {dataset.category}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="pt-2">
          <div className="text-xs text-muted-foreground mb-3">
            Slug: <code className="text-primary">{dataset.slug}</code>
            {dataset.organization && <span className="ml-4">Org: {dataset.organization}</span>}
          </div>

          {details?.resources && details.resources.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Recursos ({details.resources.length})
              </p>
              {details.resources.map((res: any) => (
                <ResourceRow key={res.id} resource={res} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Expanda para ver os recursos deste dataset.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function ResourceRow({ resource }: { resource: any }) {
  const processMutation = trpc.resources.process.useMutation({
    onSuccess: (data) => {
      toast.success(`Job ${data.jobId} enfileirado (${data.status})`);
    },
    onError: (e) => toast.error(`Erro: ${e.message}`),
  });

  const statusColor: Record<string, string> = {
    pending: "bg-muted text-muted-foreground",
    downloading: "bg-blue-500/20 text-blue-400",
    downloaded: "bg-blue-600/20 text-blue-300",
    processing: "bg-yellow-500/20 text-yellow-400",
    extracting_entities: "bg-purple-500/20 text-purple-400",
    embedding: "bg-emerald-500/20 text-emerald-400",
    embedded: "bg-emerald-600/20 text-emerald-300",
    error: "bg-destructive/20 text-destructive",
  };

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg bg-accent/20 hover:bg-accent/30 transition-colors">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{resource.name}</p>
        <p className="text-[10px] text-muted-foreground">
          Formato: {resource.format || "JSON"}
          {resource.recordCount != null && ` | ${resource.recordCount} registos`}
        </p>
      </div>
      <Badge className={`text-[10px] ${statusColor[resource.status] || ""}`}>
        {resource.status}
      </Badge>
      <Button
        size="sm"
        variant="outline"
        disabled={processMutation.isPending || resource.status === "embedded"}
        onClick={() => processMutation.mutate({ resourceId: resource.resourceId })}
        className="shrink-0"
      >
        {processMutation.isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Cog className="h-3 w-3" />
        )}
        <span className="ml-1 text-xs">Processar</span>
      </Button>
    </div>
  );
}
