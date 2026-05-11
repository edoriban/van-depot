'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export interface ColumnDef<T> {
  key: string;
  header: string;
  render: (item: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  total: number;
  page: number;
  perPage: number;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
  emptyMessage?: string;
  emptyState?: React.ReactNode;
  rowClassName?: (item: T, index: number) => string;
  getRowKey?: (item: T, index: number) => string | number;
}

export function DataTable<T>({
  columns,
  data,
  total,
  page,
  perPage,
  onPageChange,
  isLoading = false,
  emptyMessage = 'No hay datos registrados',
  emptyState,
  rowClassName,
  getRowKey,
}: DataTableProps<T>) {
  const totalPages = Math.ceil(total / perPage);
  const hasResults = data.length > 0;

  return (
    <div className="relative" style={{ minHeight: '200px' }}>
      {/* Skeleton — visible when loading, always absolute so it never enters document flow */}
      <div
        className="transition-opacity duration-200 ease-in-out"
        style={{
          opacity: isLoading ? 1 : 0,
          pointerEvents: isLoading ? 'auto' : 'none',
          position: 'absolute',
          inset: 0,
        }}
      >
        <div className="space-y-3">
          <div className="rounded-4xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => (
                    <TableHead key={col.key}>{col.header}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {columns.map((col) => (
                      <TableCell key={col.key}>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* Content area — fades in when not loading */}
      <div
        className="transition-opacity duration-200 ease-in-out"
        style={{
          opacity: isLoading ? 0 : 1,
          pointerEvents: isLoading ? 'none' : 'auto',
        }}
      >
        {/* Empty state — visible when no results, sits absolute when hidden */}
        <div
          className="transition-opacity duration-150 ease-in-out"
          style={{
            opacity: hasResults ? 0 : 1,
            pointerEvents: hasResults ? 'none' : 'auto',
            position: hasResults ? 'absolute' : 'relative',
            inset: 0,
          }}
        >
          {emptyState ? (
            <>{emptyState}</>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-4xl border py-16">
              <p className="text-muted-foreground">{emptyMessage}</p>
            </div>
          )}
        </div>

        {/* Table with results — visible when there are results */}
        <div
          className="transition-opacity duration-150 ease-in-out"
          style={{
            opacity: hasResults ? 1 : 0,
            pointerEvents: hasResults ? 'auto' : 'none',
            position: hasResults ? 'relative' : 'absolute',
            inset: 0,
          }}
        >
          <div className="space-y-4">
            <div className="rounded-4xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((col) => (
                      <TableHead key={col.key}>{col.header}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((item, idx) => (
                    // react-doctor: getRowKey is the stable id provider; idx fallback when none provided
                    <TableRow key={getRowKey?.(item, idx) ?? idx} className={rowClassName?.(item, idx)}>
                      {columns.map((col) => (
                        <TableCell key={col.key}>{col.render(item)}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Mostrando {(page - 1) * perPage + 1}-{Math.min(page * perPage, total)} de {total}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(page - 1)}
                    disabled={page <= 1}
                  >
                    Anterior
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {page} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(page + 1)}
                    disabled={page >= totalPages}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
