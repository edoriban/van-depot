'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api-mutations';
import type { Recipe, PaginatedResponse } from '@/types';
import { EmptyState } from '@/components/shared/empty-state';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  TaskDaily01Icon,
  Delete01Icon,
} from '@hugeicons/core-free-icons';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import Link from 'next/link';
import { toast } from 'sonner';
import { PageTransition } from '@/components/shared/page-transition';

export default function RecetasPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<Recipe | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const perPage = 20;

  const fetchRecipes = async (p: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<PaginatedResponse<Recipe>>(
        `/recipes?page=${p}&per_page=${perPage}`
      );
      setRecipes(res.data);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar recetas');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRecipes(page);
  }, [page]);

  const openCreateDialog = () => {
    setFormName('');
    setFormDescription('');
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await api.post('/recipes', {
        name: formName,
        description: formDescription || undefined,
        items: [],
      });
      setFormOpen(false);
      setPage(1);
      fetchRecipes(1);
      toast.success('Receta creada correctamente');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear receta');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await api.del(`/recipes/${deleteTarget.id}`);
      setDeleteTarget(null);
      fetchRecipes(page);
      toast.success('Receta eliminada correctamente');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar receta');
    } finally {
      setIsDeleting(false);
    }
  };

  const totalPages = Math.ceil(total / perPage);

  return (
    <PageTransition>
    <div className="space-y-6" data-testid="recetas-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HugeiconsIcon icon={TaskDaily01Icon} size={28} className="text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Recetas de Proyecto</h1>
            <p className="text-muted-foreground mt-1">
              Gestiona las listas de materiales para tus proyectos
            </p>
          </div>
        </div>
        <Button onClick={openCreateDialog} data-testid="new-recipe-btn">
          Nueva Receta
        </Button>
      </div>

      {error && (
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="h-5 skeleton-shimmer rounded w-2/3" />
                <div className="h-4 skeleton-shimmer rounded w-1/2 mt-2" />
              </CardHeader>
              <CardContent>
                <div className="h-4 skeleton-shimmer rounded w-1/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : recipes.length === 0 ? (
        <EmptyState
          icon={TaskDaily01Icon}
          title="Aun no tienes recetas"
          description="Crea tu primera receta de proyecto para definir los materiales que necesitas."
          actionLabel="Nueva Receta"
          onAction={openCreateDialog}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="recipe-grid">
            {recipes.map((recipe, i) => (
              <Card
                key={recipe.id}
                className="animate-fade-in-up hover:border-primary/50 transition-colors"
                style={{ animationDelay: `${i * 50}ms` }}
                data-testid="recipe-card"
              >
                <CardHeader>
                  <div className="flex flex-row items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-lg">{recipe.name}</CardTitle>
                      <CardDescription className="line-clamp-2">
                        {recipe.description || 'Sin descripcion'}
                      </CardDescription>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <Badge variant="secondary">
                        {recipe.item_count} {recipe.item_count === 1 ? 'material' : 'materiales'}
                      </Badge>
                    </div>
                  </div>
                  <CardAction>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(recipe);
                      }}
                      data-testid="delete-recipe-btn"
                    >
                      <HugeiconsIcon icon={Delete01Icon} size={16} />
                    </Button>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {new Date(recipe.created_at).toLocaleDateString('es-MX', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                    <Link
                      href={`/recetas/${recipe.id}`}
                      className="text-sm text-primary hover:underline"
                      data-testid="recipe-detail-link"
                    >
                      Ver detalle →
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2" data-testid="pagination">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground">
                Pagina {page} de {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Siguiente
              </Button>
            </div>
          )}
        </>
      )}

      {/* Create Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva Receta</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="recipe-name">Nombre</Label>
              <Input
                id="recipe-name"
                name="name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Nombre de la receta"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recipe-description">Descripcion (opcional)</Label>
              <Textarea
                id="recipe-description"
                name="description"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Descripcion del proyecto o receta"
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
                disabled={isSaving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSaving} data-testid="submit-btn">
                {isSaving ? 'Creando...' : 'Crear'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Eliminar receta"
        description={`Se eliminara la receta "${deleteTarget?.name}". Esta accion no se puede deshacer.`}
        onConfirm={handleDelete}
        isLoading={isDeleting}
      />
    </div>
    </PageTransition>
  );
}
