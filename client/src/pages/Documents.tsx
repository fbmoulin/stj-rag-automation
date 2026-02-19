import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Upload, FileText, Cog, Loader2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

export default function Documents() {
  const { data: docs, isLoading, refetch } = trpc.documents.list.useQuery();
  const uploadMutation = trpc.documents.upload.useMutation({
    onSuccess: () => {
      toast.success("Documento carregado com sucesso!");
      refetch();
    },
    onError: (e) => toast.error(`Erro: ${e.message}`),
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = 15 * 1024 * 1024; // 15MB
    if (file.size > maxSize) {
      toast.error("Ficheiro demasiado grande. Máximo: 15MB");
      return;
    }

    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1];
        await uploadMutation.mutateAsync({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          base64Data: base64,
        });
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setUploading(false);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-gradient-orange">Documentos</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Carregue documentos PDF, DOCX ou TXT para gerar embeddings e integrar ao GraphRAG
          </p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.doc,.txt,.json"
            className="hidden"
            onChange={handleUpload}
          />
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="gradient-orange text-white"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Upload className="h-4 w-4 mr-2" />
            )}
            Carregar Documento
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : !docs || docs.length === 0 ? (
        <Card className="glass-card border-border/50">
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              Nenhum documento carregado. Carregue um PDF, DOCX ou TXT para começar.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {docs.map((doc: any) => (
            <DocumentRow key={doc.id} doc={doc} onRefresh={refetch} />
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentRow({ doc, onRefresh }: { doc: any; onRefresh: () => void }) {
  const processMutation = trpc.documents.process.useMutation({
    onSuccess: (data) => {
      toast.success(`Job ${data.jobId} enfileirado (${data.status})`);
      onRefresh();
    },
    onError: (e) => toast.error(`Erro: ${e.message}`),
  });

  const statusColor: Record<string, string> = {
    uploaded: "bg-blue-500/20 text-blue-400",
    extracting: "bg-yellow-500/20 text-yellow-400",
    extracted: "bg-yellow-600/20 text-yellow-300",
    chunking: "bg-purple-500/20 text-purple-400",
    chunked: "bg-purple-600/20 text-purple-300",
    extracting_entities: "bg-orange-500/20 text-orange-400",
    entities_extracted: "bg-orange-600/20 text-orange-300",
    embedding: "bg-emerald-500/20 text-emerald-400",
    embedded: "bg-emerald-600/20 text-emerald-300",
    error: "bg-destructive/20 text-destructive",
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Card className="glass-card border-border/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          <div className="p-2.5 rounded-lg bg-primary/10 shrink-0">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{doc.filename}</p>
            <p className="text-[10px] text-muted-foreground">
              {doc.mimeType} | {doc.fileSize ? formatSize(doc.fileSize) : "-"}
              {doc.chunkCount != null && ` | ${doc.chunkCount} chunks`}
              {doc.entityCount != null && ` | ${doc.entityCount} entidades`}
            </p>
          </div>
          <Badge className={`text-[10px] ${statusColor[doc.status] || ""}`}>
            {doc.status}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            disabled={processMutation.isPending || doc.status === "embedded"}
            onClick={() => processMutation.mutate({ documentId: doc.id })}
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
      </CardContent>
    </Card>
  );
}
