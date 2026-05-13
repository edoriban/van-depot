/**
 * components/almacenes/warehouse-card.tsx — single warehouse card with
 * floating critical badge, stats grid, health bar, last-movement line, and
 * a footer "Ver almacen" link.
 *
 * See `frontend/src/CONVENTIONS.md` §7.1 and
 * `sdd/frontend-migration-almacenes/spec` ALM-LIST-INV-4. Helpers `timeAgo`,
 * `healthPercent/Color/Label` and the `StatCell` mini-component live inline
 * (single consumer). Testids preserved: warehouse-card, warehouse-detail-link,
 * warehouse-view-link, edit-warehouse-btn, delete-warehouse-btn.
 */
'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Delete01Icon, PencilEdit01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';
import type { Warehouse, WarehouseWithStats } from '@/types';

// --- Helpers (single-consumer; live alongside the card per design §2.1) ----

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days}d`;
  const months = Math.floor(days / 30);
  return `hace ${months} mes${months > 1 ? 'es' : ''}`;
}

function healthPercent(w: WarehouseWithStats): number {
  if (w.products_count === 0) return 100;
  return Math.round(
    ((w.products_count - w.low_stock_count - w.critical_count) /
      w.products_count) *
      100,
  );
}

function healthColor(pct: number): string {
  if (pct >= 80) return 'bg-green-500';
  if (pct >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

function healthLabel(pct: number): string {
  if (pct >= 80) return 'Buena';
  if (pct >= 50) return 'Regular';
  return 'Critica';
}

// --- StatCell — inline mini-component for the 4-cell stats grid -----------

type StatTone = 'muted' | 'amber' | 'red';

const STAT_TONE_BG: Record<StatTone, string> = {
  muted: 'bg-muted/50',
  amber: 'bg-amber-50 dark:bg-amber-950',
  red: 'bg-red-50 dark:bg-red-950',
};

const STAT_TONE_VALUE_TEXT: Record<StatTone, string> = {
  muted: '',
  amber: 'text-amber-600 dark:text-amber-400',
  red: 'text-red-600 dark:text-red-400',
};

const STAT_TONE_LABEL_TEXT: Record<StatTone, string> = {
  muted: 'text-muted-foreground',
  amber: 'text-amber-600 dark:text-amber-400',
  red: 'text-red-600 dark:text-red-400',
};

function StatCell({
  value,
  label,
  tone = 'muted',
}: {
  value: number;
  label: string;
  tone?: StatTone;
}) {
  return (
    <div className={`rounded-md p-2 text-center ${STAT_TONE_BG[tone]}`}>
      <p
        className={`text-lg font-bold leading-none ${STAT_TONE_VALUE_TEXT[tone]}`}
      >
        {value}
      </p>
      <p className={`text-[10px] mt-1 ${STAT_TONE_LABEL_TEXT[tone]}`}>
        {label}
      </p>
    </div>
  );
}

// --- Component ----------------------------------------------------------

interface WarehouseCardProps {
  warehouse: WarehouseWithStats;
  index: number;
  onEdit: (warehouse: Warehouse) => void;
  onDelete: (warehouse: Warehouse) => void;
}

export function WarehouseCard({
  warehouse,
  index,
  onEdit,
  onDelete,
}: WarehouseCardProps) {
  const health = healthPercent(warehouse);
  const hasStats = warehouse.products_count > 0;

  return (
    <Card
      className="animate-fade-in-up hover:border-primary/50 transition-colors relative"
      style={{ animationDelay: `${index * 50}ms` }}
      data-testid="warehouse-card"
    >
      {/* Alert badges - top right corner */}
      {warehouse.critical_count > 0 && (
        <div className="absolute -top-2 -right-2 z-10">
          <Badge className="bg-red-600 text-white text-xs shadow-md">
            {warehouse.critical_count} critico
            {warehouse.critical_count !== 1 ? 's' : ''}
          </Badge>
        </div>
      )}

      <CardHeader>
        <div className="flex flex-row items-start justify-between">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-lg">
              <Link
                href={`/almacenes/${warehouse.id}`}
                className="hover:underline"
                data-testid="warehouse-detail-link"
              >
                {warehouse.name}
              </Link>
            </CardTitle>
            <CardDescription>
              {warehouse.address || 'Sin direccion'}
            </CardDescription>
          </div>
          <div className="flex gap-1 shrink-0 ml-2">
            <Badge variant={warehouse.is_active ? 'default' : 'secondary'}>
              {warehouse.is_active ? 'Activo' : 'Inactivo'}
            </Badge>
          </div>
        </div>
        <CardAction>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(warehouse);
              }}
              data-testid="edit-warehouse-btn"
            >
              <HugeiconsIcon icon={PencilEdit01Icon} size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(warehouse);
              }}
              data-testid="delete-warehouse-btn"
            >
              <HugeiconsIcon icon={Delete01Icon} size={16} />
            </Button>
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-2">
          <StatCell value={warehouse.locations_count} label="Ubic." />
          <StatCell value={warehouse.products_count} label="Prod." />
          <StatCell
            value={warehouse.low_stock_count}
            label="Bajos"
            tone={warehouse.low_stock_count > 0 ? 'amber' : 'muted'}
          />
          <StatCell
            value={warehouse.critical_count}
            label="Crit."
            tone={warehouse.critical_count > 0 ? 'red' : 'muted'}
          />
        </div>

        {/* Health bar */}
        {hasStats && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Salud del inventario
              </span>
              <span
                className={`font-medium ${
                  health >= 80
                    ? 'text-green-600 dark:text-green-400'
                    : health >= 50
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-red-600 dark:text-red-400'
                }`}
              >
                {health}% {healthLabel(health)}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${healthColor(health)}`}
                style={{ width: `${health}%` }}
              />
            </div>
          </div>
        )}

        {!hasStats && (
          <p className="text-xs text-muted-foreground italic">
            Sin productos registrados
          </p>
        )}

        {/* Last movement */}
        <p className="text-xs text-muted-foreground">
          {warehouse.last_movement_at
            ? `Ultimo movimiento: ${timeAgo(warehouse.last_movement_at)}`
            : 'Sin actividad registrada'}
        </p>

        {/* Footer link */}
        <div className="pt-1 border-t">
          <Link
            href={`/almacenes/${warehouse.id}`}
            className="text-sm font-medium text-primary hover:underline"
            data-testid="warehouse-view-link"
          >
            Ver almacen →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
