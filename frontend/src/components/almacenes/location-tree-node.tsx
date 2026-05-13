/**
 * components/almacenes/location-tree-node.tsx — recursive tree-row component
 * for the Ubicaciones tab on the warehouse detail page.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 and
 * `sdd/frontend-migration-almacenes/spec` ALM-DETAIL-INV-3.
 * Design §2.2 LOCKED — this file carries `CHILD_TYPES`, `LOCATION_TYPE_*`
 * constants inline (single primary consumer; re-exported for the dialog).
 *
 * Side-effect-free recursion: callbacks come from the parent so this
 * component never touches the Zustand store directly. Hover-revealed
 * actions, type badge tooltip, child count, chevron rotation, and the
 * inline `+ Agregar` empty-child hint all match legacy
 * `[id]/page.tsx:177-335`.
 */
'use client';

import type { Location, LocationType } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Allowed child types per parent type. Defines the location hierarchy:
 *   zone > rack > shelf > position > bin.
 * Exported so `location-create-edit-dialog.tsx` can reuse the same map
 * without re-declaring (design §2.2 — single source).
 */
export const CHILD_TYPES: Record<string, LocationType[]> = {
  zone: ['rack', 'shelf'],
  rack: ['shelf', 'position'],
  shelf: ['position', 'bin'],
  position: ['bin'],
  bin: [],
};

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  zone: 'Zona',
  rack: 'Rack',
  shelf: 'Estante',
  position: 'Posicion',
  bin: 'Contenedor',
  reception: 'Recepcion',
  work_center: 'Centro de trabajo',
  finished_good: 'Producto terminado',
  outbound: 'Salida',
};

export const LOCATION_TYPE_DESCRIPTIONS: Record<LocationType, string> = {
  zone: 'Area principal del almacen (ej: Zona de refrigerados, Zona de secos)',
  rack: 'Estanteria o mueble dentro de una zona (ej: Rack A1, Rack B2)',
  shelf: 'Nivel o repisa dentro de un rack (ej: Nivel superior, Nivel medio)',
  position: 'Espacio especifico dentro de un estante (ej: Posicion izquierda, centro)',
  bin: 'Contenedor o caja dentro de una posicion (ej: Caja 01, Contenedor azul)',
  reception: 'Zona de recepcion del almacen (creada automaticamente)',
  work_center: 'Centro de trabajo donde se consumen materiales de las ordenes de trabajo',
  finished_good: 'Ubicacion reservada para producto terminado (creada automaticamente)',
  outbound: 'Zona de salida o despacho del almacen',
};

export const LOCATION_TYPE_STYLES: Record<LocationType, string> = {
  zone: 'bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-700',
  rack: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700',
  shelf: 'bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-700',
  position: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700',
  bin: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700',
  reception: 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-900/30 dark:text-slate-300 dark:border-slate-700',
  work_center: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700',
  finished_good: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700',
  outbound: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-700',
};

export const LOCATION_TYPES_DEFAULT: LocationType[] = [
  'zone',
  'rack',
  'shelf',
  'position',
  'bin',
];

interface LocationTreeNodeProps {
  location: Location;
  allLocations: Location[];
  depth: number;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onAddChild: (parentId: string, parentType: LocationType) => void;
  onEdit: (location: Location) => void;
  onDelete: (location: Location) => void;
}

export function LocationTreeNode({
  location,
  allLocations,
  depth,
  expandedIds,
  onToggleExpand,
  onAddChild,
  onEdit,
  onDelete,
}: LocationTreeNodeProps) {
  const children = allLocations.filter((l) => l.parent_id === location.id);
  const allowedChildren = CHILD_TYPES[location.location_type] ?? [];
  const canHaveChildren = allowedChildren.length > 0;
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(location.id);

  return (
    <div>
      <div
        className="flex items-center gap-2 py-2 px-3 hover:bg-muted/50 rounded-lg group"
        style={{ paddingLeft: `${depth * 24 + 12}px` }}
      >
        <button
          type="button"
          className={cn(
            'flex items-center justify-center size-5 rounded transition-colors shrink-0',
            hasChildren || canHaveChildren
              ? 'hover:bg-muted cursor-pointer'
              : '',
          )}
          onClick={() =>
            (hasChildren || canHaveChildren) && onToggleExpand(location.id)
          }
          tabIndex={hasChildren || canHaveChildren ? 0 : -1}
          aria-label={isExpanded ? 'Colapsar' : 'Expandir'}
        >
          {hasChildren || canHaveChildren ? (
            <svg
              className={cn(
                'size-4 text-muted-foreground transition-transform duration-200',
                isExpanded && 'rotate-90',
              )}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 5l7 7-7 7"
              />
            </svg>
          ) : (
            <span className="w-4" />
          )}
        </button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className={cn(
                'text-xs shrink-0 cursor-help',
                LOCATION_TYPE_STYLES[location.location_type],
              )}
            >
              {LOCATION_TYPE_LABELS[location.location_type] ??
                location.location_type}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            {LOCATION_TYPE_DESCRIPTIONS[location.location_type]}
          </TooltipContent>
        </Tooltip>

        <button
          type="button"
          className="font-medium flex-1 truncate text-left hover:underline"
          onClick={() =>
            (hasChildren || canHaveChildren) && onToggleExpand(location.id)
          }
        >
          {location.name}
        </button>

        {hasChildren && (
          <span className="text-xs text-muted-foreground shrink-0">
            {children.length} sub
          </span>
        )}

        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {canHaveChildren && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() =>
                onAddChild(location.id, location.location_type)
              }
            >
              + Agregar
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onEdit(location)}
            data-testid="edit-location-btn"
          >
            Editar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-destructive"
            onClick={() => onDelete(location)}
            data-testid="delete-location-btn"
          >
            Eliminar
          </Button>
        </div>
      </div>

      {isExpanded && hasChildren && (
        <div>
          {children.map((child) => (
            <LocationTreeNode
              key={child.id}
              location={child}
              allLocations={allLocations}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggleExpand={onToggleExpand}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}

      {isExpanded && !hasChildren && canHaveChildren && (
        <div
          className="flex items-center gap-2 py-1.5 px-3 text-sm text-muted-foreground"
          style={{ paddingLeft: `${(depth + 1) * 24 + 12}px` }}
        >
          <span className="w-5" />
          <button
            type="button"
            className="hover:text-foreground transition-colors cursor-pointer"
            onClick={() =>
              onAddChild(location.id, location.location_type)
            }
          >
            + Agregar{' '}
            {LOCATION_TYPE_LABELS[allowedChildren[0]] ?? 'sub-ubicacion'}
          </button>
        </div>
      )}
    </div>
  );
}
