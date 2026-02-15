import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Network, GitBranch, Users, Loader2, Search, RefreshCw,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";

export default function Graph() {
  const { data: nodeStats, isLoading: loadingNodes } = trpc.graph.nodeStats.useQuery();
  const { data: edgeStats, isLoading: loadingEdges } = trpc.graph.edgeStats.useQuery();
  const { data: communities } = trpc.graph.communities.useQuery();
  const { data: vizData, isLoading: loadingViz } = trpc.graph.visualization.useQuery();
  const buildMutation = trpc.graph.buildCommunities.useMutation({
    onSuccess: () => {
      toast.success("Comunidades construídas com sucesso!");
    },
    onError: (e) => toast.error(`Erro: ${e.message}`),
  });

  const [searchTerm, setSearchTerm] = useState("");
  const { data: searchResults } = trpc.graph.nodes.useQuery(
    { search: searchTerm, limit: 20 },
    { enabled: searchTerm.length >= 2 }
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-gradient-orange">Grafo de Conhecimento</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Entidades, relações e comunidades extraídas dos precedentes do STJ
          </p>
        </div>
        <Button
          onClick={() => buildMutation.mutate()}
          disabled={buildMutation.isPending}
          className="gradient-orange text-white"
        >
          {buildMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Construir Comunidades
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="glass-card border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg gradient-orange">
                <Network className="h-4 w-4 text-white" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Entidades</p>
                <p className="text-lg font-bold">
                  {loadingNodes ? "..." : nodeStats?.reduce((a: number, b: any) => a + Number(b.count), 0) || 0}
                </p>
              </div>
            </div>
            {nodeStats && nodeStats.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {nodeStats.map((s: any) => (
                  <Badge key={s.entityType} variant="secondary" className="text-[10px]">
                    {s.entityType}: {s.count}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-600">
                <GitBranch className="h-4 w-4 text-white" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Relações</p>
                <p className="text-lg font-bold">
                  {loadingEdges ? "..." : edgeStats?.reduce((a: number, b: any) => a + Number(b.count), 0) || 0}
                </p>
              </div>
            </div>
            {edgeStats && edgeStats.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {edgeStats.map((s: any) => (
                  <Badge key={s.relationshipType} variant="secondary" className="text-[10px]">
                    {s.relationshipType}: {s.count}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-600">
                <Users className="h-4 w-4 text-white" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Comunidades</p>
                <p className="text-lg font-bold">{communities?.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <Card className="glass-card border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" />
            Pesquisar Entidades
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Input
            placeholder="Pesquisar ministros, processos, temas..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="bg-accent/30 border-border/50"
          />
          {searchResults && searchResults.length > 0 && (
            <div className="mt-3 space-y-2 max-h-60 overflow-y-auto">
              {searchResults.map((node: any) => (
                <div
                  key={node.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg bg-accent/20 hover:bg-accent/30 transition-colors"
                >
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {node.entityType}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{node.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {node.description || "-"}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {node.mentionCount}x
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Graph Visualization */}
      <Card className="glass-card border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Network className="h-4 w-4 text-primary" />
            Visualização do Grafo
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingViz ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : vizData && vizData.nodes.length > 0 ? (
            <GraphCanvas nodes={vizData.nodes} edges={vizData.edges} />
          ) : (
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              <p className="text-sm">
                Nenhum dado no grafo. Processe datasets ou documentos primeiro.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Communities */}
      {communities && communities.length > 0 && (
        <Card className="glass-card border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Comunidades ({communities.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {communities.slice(0, 10).map((comm: any) => (
              <div
                key={comm.id}
                className="p-3 rounded-lg bg-accent/20 hover:bg-accent/30 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium">
                    {comm.title || `Comunidade ${comm.communityId}`}
                  </p>
                  <div className="flex gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      {comm.entityCount} entidades
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {comm.edgeCount} relações
                    </Badge>
                  </div>
                </div>
                {comm.summary && (
                  <p className="text-xs text-muted-foreground line-clamp-3">
                    {comm.summary}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Simple force-directed graph canvas */
function GraphCanvas({
  nodes,
  edges,
}: {
  nodes: { id: string; name: string; type: string; mentions: number; community: number | null }[];
  edges: { source: string; target: string; type: string; weight: number }[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width = canvas.offsetWidth * 2;
    const height = canvas.height = 600 * 2;
    canvas.style.height = "600px";

    // Assign positions using simple force layout
    const nodePositions = new Map<string, { x: number; y: number }>();
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * 2 * Math.PI;
      const r = Math.min(width, height) * 0.35;
      nodePositions.set(n.id, {
        x: width / 2 + r * Math.cos(angle) + (Math.random() - 0.5) * 100,
        y: height / 2 + r * Math.sin(angle) + (Math.random() - 0.5) * 100,
      });
    });

    // Simple force simulation (few iterations)
    for (let iter = 0; iter < 50; iter++) {
      // Repulsion
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodePositions.get(nodes[i].id)!;
          const b = nodePositions.get(nodes[j].id)!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = 50000 / (dist * dist);
          a.x -= (dx / dist) * force;
          a.y -= (dy / dist) * force;
          b.x += (dx / dist) * force;
          b.y += (dy / dist) * force;
        }
      }
      // Attraction along edges
      edges.forEach(e => {
        const a = nodePositions.get(e.source);
        const b = nodePositions.get(e.target);
        if (!a || !b) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (dist - 200) * 0.01;
        a.x += (dx / dist) * force;
        a.y += (dy / dist) * force;
        b.x -= (dx / dist) * force;
        b.y -= (dy / dist) * force;
      });
      // Center gravity
      nodes.forEach(n => {
        const p = nodePositions.get(n.id)!;
        p.x += (width / 2 - p.x) * 0.01;
        p.y += (height / 2 - p.y) * 0.01;
      });
    }

    // Draw
    ctx.clearRect(0, 0, width, height);

    // Edges
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    edges.forEach(e => {
      const a = nodePositions.get(e.source);
      const b = nodePositions.get(e.target);
      if (!a || !b) return;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });

    // Nodes
    const typeColors: Record<string, string> = {
      ministro: "#f97316",
      processo: "#3b82f6",
      orgao_julgador: "#8b5cf6",
      tema: "#10b981",
      legislacao: "#ef4444",
      parte: "#06b6d4",
      precedente: "#f59e0b",
      decisao: "#ec4899",
    };

    nodes.forEach(n => {
      const pos = nodePositions.get(n.id)!;
      const radius = Math.max(6, Math.min(20, n.mentions * 2)) * 2;
      const color = typeColors[n.type] || "#6b7280";

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.8;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Label
      if (n.mentions >= 2 || nodes.length < 50) {
        ctx.font = "20px Inter, sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.textAlign = "center";
        ctx.fillText(n.name.substring(0, 25), pos.x, pos.y - radius - 8);
      }
    });
  }, [nodes, edges]);

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="w-full rounded-lg bg-background/50"
        style={{ height: "600px" }}
      />
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-2">
        {[
          { type: "ministro", color: "#f97316" },
          { type: "processo", color: "#3b82f6" },
          { type: "tema", color: "#10b981" },
          { type: "legislação", color: "#ef4444" },
          { type: "órgão", color: "#8b5cf6" },
        ].map(({ type, color }) => (
          <div key={type} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
            {type}
          </div>
        ))}
      </div>
    </div>
  );
}
