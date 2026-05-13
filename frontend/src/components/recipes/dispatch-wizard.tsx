'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-mutations';
import type {
  Warehouse,
  Location,
  ItemAvailability,
  AvailabilityResponse,
  DispatchResponse,
  PaginatedResponse,
} from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Tick02Icon,
  Store01Icon,
} from '@hugeicons/core-free-icons';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// --- Step indicator ---

function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  const steps = [
    { number: 1, label: 'Almacen' },
    { number: 2, label: 'Disponibilidad' },
    { number: 3, label: 'Confirmar' },
  ] as const;

  return (
    <div className="flex items-center justify-center gap-0" data-testid="step-indicator">
      {steps.map((step, idx) => (
        <div key={step.number} className="flex items-center">
          <div className="flex flex-col items-center gap-1">
            <div
              className={cn(
                'flex size-8 items-center justify-center rounded-full text-xs font-medium transition-colors',
                step.number === current
                  ? 'bg-primary text-primary-foreground'
                  : step.number < current
                    ? 'bg-green-600 text-white'
                    : 'bg-muted text-muted-foreground'
              )}
            >
              {step.number < current ? (
                <HugeiconsIcon icon={Tick02Icon} size={14} />
              ) : (
                step.number
              )}
            </div>
            <span
              className={cn(
                'text-xs',
                step.number === current
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground'
              )}
            >
              {step.label}
            </span>
          </div>
          {idx < steps.length - 1 && (
            <div
              className={cn(
                'mx-2 mb-5 h-0.5 w-10 rounded-full',
                step.number < current ? 'bg-green-600' : 'bg-muted'
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// --- Availability badge ---

function AvailabilityBadge({ item }: { item: ItemAvailability }) {
  if (item.status === 'available') {
    return (
      <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
        Disponible
      </Badge>
    );
  }
  if (item.status === 'insufficient') {
    return (
      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
        Insuficiente ({item.available_quantity} de {item.required_quantity})
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
      Sin stock
    </Badge>
  );
}

// --- Props ---

interface DispatchWizardProps {
  recipeId: string;
  recipeName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDispatchComplete: () => void;
}

// --- Wizard ---

/**
 * Public wrapper. Internal wizard state lives in a body sub-component that
 * mounts on open and unmounts on close — this guarantees a clean reset every
 * session without the "useEffect simulating an event handler" anti-pattern.
 */
export function DispatchWizard(props: DispatchWizardProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && <DispatchWizardBody {...props} />}
    </Dialog>
  );
}

function DispatchWizardBody({
  recipeId,
  recipeName,
  onOpenChange,
  onDispatchComplete,
}: Omit<DispatchWizardProps, 'open'>) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: warehouses
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehousesLoading, setWarehousesLoading] = useState(false);
  const [selectedWarehouse, setSelectedWarehouse] = useState<Warehouse | null>(null);

  // Step 2: availability
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);

  // Step 3: dispatch
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [isDispatching, setIsDispatching] = useState(false);

  // Fetch warehouses on mount (which only happens when the dialog opens).
  useEffect(() => {
    fetchWarehouses();
  }, []);

  const fetchWarehouses = async () => {
    setWarehousesLoading(true);
    try {
      const res = await api.get<PaginatedResponse<Warehouse>>(
        '/warehouses?per_page=100&page=1'
      );
      setWarehouses(res.data);
    } catch {
      toast.error('Error al cargar almacenes');
    } finally {
      setWarehousesLoading(false);
    }
  };

  const checkAvailability = useCallback(async (warehouseId: string) => {
    setAvailabilityLoading(true);
    try {
      const res = await api.get<AvailabilityResponse>(
        `/recipes/${recipeId}/availability?warehouse_id=${warehouseId}`
      );
      setAvailability(res);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al verificar disponibilidad'
      );
    } finally {
      setAvailabilityLoading(false);
    }
  }, [recipeId]);

  const fetchLocations = useCallback(async (warehouseId: string) => {
    setLocationsLoading(true);
    try {
      const res = await api.get<PaginatedResponse<Location>>(
        `/warehouses/${warehouseId}/locations?per_page=200&page=1`
      );
      setLocations(res.data);
    } catch {
      toast.error('Error al cargar ubicaciones');
    } finally {
      setLocationsLoading(false);
    }
  }, []);

  // Go to step 2: auto-fetch availability
  const goToStep2 = () => {
    if (!selectedWarehouse) return;
    setStep(2);
    setAvailability(null);
    checkAvailability(selectedWarehouse.id);
  };

  // Go to step 3: fetch locations
  const goToStep3 = () => {
    if (!selectedWarehouse) return;
    setStep(3);
    setSelectedLocationId('');
    fetchLocations(selectedWarehouse.id);
  };

  const handleDispatch = async () => {
    if (!selectedWarehouse || !selectedLocationId) return;
    setIsDispatching(true);
    try {
      const res = await api.post<DispatchResponse>(`/recipes/${recipeId}/dispatch`, {
        warehouse_id: selectedWarehouse.id,
        location_id: selectedLocationId,
      });
      toast.success(`Se crearon ${res.movements_created} movimientos de salida`);
      onOpenChange(false);
      onDispatchComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al despachar');
    } finally {
      setIsDispatching(false);
    }
  };

  // Availability summary
  const availableCount = availability?.items.filter(
    (i) => i.status === 'available'
  ).length ?? 0;
  const totalCount = availability?.items.length ?? 0;

  return (
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto"
        data-testid="dispatch-wizard"
      >
        <DialogHeader>
          <DialogTitle>Despachar Receta</DialogTitle>
          <DialogDescription>{recipeName}</DialogDescription>
        </DialogHeader>

        <StepIndicator current={step} />

        {/* Step 1: Select warehouse */}
        {step === 1 && (
          <div className="space-y-4" data-testid="wizard-step-1">
            <p className="text-sm text-muted-foreground">
              Selecciona el almacen de origen para el despacho.
            </p>

            {warehousesLoading ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {['s1', 's2', 's3', 's4'].map((id) => (
                  <div
                    key={id}
                    className="h-20 rounded-xl bg-muted animate-pulse"
                  />
                ))}
              </div>
            ) : warehouses.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No hay almacenes disponibles.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {warehouses.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setSelectedWarehouse(w)}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border p-4 text-left transition-all hover:bg-accent/50',
                      selectedWarehouse?.id === w.id
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border'
                    )}
                    data-testid={`warehouse-card-${w.id}`}
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <HugeiconsIcon
                        icon={Store01Icon}
                        size={18}
                        className="text-muted-foreground"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{w.name}</p>
                      {w.address && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {w.address}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                onClick={goToStep2}
                disabled={!selectedWarehouse}
                data-testid="wizard-next-step1"
              >
                Siguiente
                <HugeiconsIcon icon={ArrowRight01Icon} size={16} className="ml-2" />
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Availability check */}
        {step === 2 && (
          <div className="space-y-4" data-testid="wizard-step-2">
            {availabilityLoading ? (
              <div className="space-y-3">
                <div className="h-6 w-48 rounded bg-muted animate-pulse" />
                <div className="h-32 rounded-xl bg-muted animate-pulse" />
              </div>
            ) : availability ? (
              <>
                {/* Summary badge */}
                <div className="flex items-center gap-2">
                  <Badge
                    className={cn(
                      availability.all_available
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                    )}
                  >
                    {availableCount} de {totalCount} materiales disponibles
                  </Badge>
                </div>

                {!availability.all_available && (
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    Algunos materiales no tienen stock suficiente. Puedes continuar
                    con un despacho parcial.
                  </p>
                )}

                {/* Availability table */}
                <div className="rounded-xl border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Requerido</TableHead>
                        <TableHead className="text-right">Disponible</TableHead>
                        <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {availability.items.map((item) => (
                        <TableRow key={item.product_id}>
                          <TableCell>
                            <div>
                              <span className="font-medium">{item.product_name}</span>
                              <span className="ml-2 font-mono text-xs text-muted-foreground">
                                {item.product_sku}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {item.required_quantity}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {item.available_quantity}
                          </TableCell>
                          <TableCell>
                            <AvailabilityBadge item={item} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            ) : null}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setStep(1)}
                data-testid="wizard-back-step2"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} size={16} className="mr-2" />
                Atras
              </Button>
              {availability && (
                availability.all_available ? (
                  <Button
                    onClick={goToStep3}
                    data-testid="wizard-next-step2"
                  >
                    Siguiente
                    <HugeiconsIcon icon={ArrowRight01Icon} size={16} className="ml-2" />
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={goToStep3}
                    className="border-amber-500 text-amber-700 hover:bg-amber-50 dark:border-amber-600 dark:text-amber-400 dark:hover:bg-amber-950"
                    data-testid="wizard-next-step2-partial"
                  >
                    Continuar de todos modos
                    <HugeiconsIcon icon={ArrowRight01Icon} size={16} className="ml-2" />
                  </Button>
                )
              )}
            </DialogFooter>
          </div>
        )}

        {/* Step 3: Confirm dispatch */}
        {step === 3 && (
          <div className="space-y-4" data-testid="wizard-step-3">
            {/* Summary */}
            <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Receta</span>
                <span className="font-medium">{recipeName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Almacen</span>
                <span className="font-medium">{selectedWarehouse?.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Materiales</span>
                <span className="font-medium">
                  {availableCount} de {totalCount} disponibles
                </span>
              </div>
            </div>

            {/* Location selector */}
            <div className="space-y-2">
              <label htmlFor="wizard-location-select" className="text-sm font-medium">
                Ubicacion de origen
              </label>
              {locationsLoading ? (
                <div className="h-10 rounded-lg bg-muted animate-pulse" />
              ) : (
                <Select
                  value={selectedLocationId}
                  onValueChange={setSelectedLocationId}
                >
                  <SelectTrigger id="wizard-location-select" className="w-full" data-testid="wizard-location-select">
                    <SelectValue placeholder="Seleccionar ubicacion" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setStep(2)}
                disabled={isDispatching}
                data-testid="wizard-back-step3"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} size={16} className="mr-2" />
                Atras
              </Button>
              <Button
                onClick={handleDispatch}
                disabled={!selectedLocationId || isDispatching}
                data-testid="wizard-dispatch-btn"
              >
                {isDispatching ? 'Despachando...' : 'Despachar'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
  );
}
