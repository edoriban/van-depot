'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-mutations';
import type { Warehouse, LocationType, UnitType, CreateUserResponse } from '@/types';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  Factory01Icon,
  Tree01Icon,
  Wrench01Icon,
  Store01Icon,
  PaintBrush01Icon,
  Settings01Icon,
  Add01Icon,
  Cancel01Icon,
  UserAdd01Icon,
  Mail01Icon,
  CheckmarkCircle02Icon,
  RocketIcon,
  Package01Icon,
  SparklesIcon,
} from '@hugeicons/core-free-icons';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import Link from 'next/link';

// --- Types ---

interface TemplateLocation {
  name: string;
  type: LocationType;
}

interface Template {
  name: string;
  icon: typeof Factory01Icon;
  locations: TemplateLocation[];
}

interface ProductDraft {
  id: string;
  name: string;
  sku: string;
  unit_of_measure: UnitType;
}

interface InviteDraft {
  id: string;
  email: string;
  name: string;
  role: 'warehouse_manager' | 'operator';
  sent: boolean;
}

// --- Constants ---

const TEMPLATES: Record<string, Template> = {
  herreria: {
    name: 'Herrería / Taller metalúrgico',
    icon: Factory01Icon,
    locations: [
      { name: 'Materia prima', type: 'zone' },
      { name: 'Zona de corte', type: 'zone' },
      { name: 'Zona de soldadura', type: 'zone' },
      { name: 'Producto terminado', type: 'zone' },
      { name: 'Herramientas', type: 'zone' },
    ],
  },
  carpinteria: {
    name: 'Carpintería / Mueblería',
    icon: Tree01Icon,
    locations: [
      { name: 'Madera', type: 'zone' },
      { name: 'Herrajes y tornillería', type: 'zone' },
      { name: 'Acabados y pinturas', type: 'zone' },
      { name: 'Producto en proceso', type: 'zone' },
      { name: 'Producto terminado', type: 'zone' },
    ],
  },
  taller_mecanico: {
    name: 'Taller mecánico',
    icon: Wrench01Icon,
    locations: [
      { name: 'Refacciones', type: 'zone' },
      { name: 'Aceites y lubricantes', type: 'zone' },
      { name: 'Herramientas', type: 'zone' },
      { name: 'Consumibles', type: 'zone' },
      { name: 'Partes usadas', type: 'zone' },
    ],
  },
  refaccionaria: {
    name: 'Refaccionaria / Ferretería',
    icon: Store01Icon,
    locations: [
      { name: 'Estante A - Eléctrico', type: 'rack' },
      { name: 'Estante B - Plomería', type: 'rack' },
      { name: 'Estante C - Herramientas', type: 'rack' },
      { name: 'Mostrador', type: 'zone' },
      { name: 'Bodega', type: 'zone' },
    ],
  },
  pintura: {
    name: 'Taller de pintura',
    icon: PaintBrush01Icon,
    locations: [
      { name: 'Pinturas y bases', type: 'zone' },
      { name: 'Solventes', type: 'zone' },
      { name: 'Cabina de pintura', type: 'zone' },
      { name: 'Producto terminado', type: 'zone' },
      { name: 'Consumibles', type: 'zone' },
    ],
  },
  personalizado: {
    name: 'Personalizado',
    icon: Settings01Icon,
    locations: [],
  },
};

const UNIT_OPTIONS: { value: UnitType; label: string }[] = [
  { value: 'piece', label: 'Pieza' },
  { value: 'kg', label: 'Kilogramo' },
  { value: 'gram', label: 'Gramo' },
  { value: 'liter', label: 'Litro' },
  { value: 'ml', label: 'Mililitro' },
  { value: 'meter', label: 'Metro' },
  { value: 'cm', label: 'Centímetro' },
  { value: 'box', label: 'Caja' },
  { value: 'pack', label: 'Paquete' },
];

const TOTAL_STEPS = 4;

function generateSku(name: string): string {
  return name
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6)
    .padEnd(3, 'X');
}

function createId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// --- Main Component ---

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);

  // Step 1
  const [warehouseName, setWarehouseName] = useState('');
  const [warehouseAddress, setWarehouseAddress] = useState('');
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);

  // Step 2
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [locationsCreated, setLocationsCreated] = useState(0);

  // Step 3
  const [products, setProducts] = useState<ProductDraft[]>([
    { id: createId(), name: '', sku: '', unit_of_measure: 'piece' },
  ]);
  const [productsCreated, setProductsCreated] = useState(0);

  // Step 4
  const [invites, setInvites] = useState<InviteDraft[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<'warehouse_manager' | 'operator'>('operator');
  const [inviteCodeToShow, setInviteCodeToShow] = useState<string | null>(null);

  // --- Step 1: Create Warehouse ---

  const handleCreateWarehouse = useCallback(async () => {
    if (!warehouseName.trim()) return;
    setIsLoading(true);
    try {
      const res = await api.post<Warehouse>('/warehouses', {
        name: warehouseName.trim(),
        address: warehouseAddress.trim() || undefined,
      });
      setWarehouse(res);
      toast.success('Almacén creado');
      setStep(2);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear el almacén');
    } finally {
      setIsLoading(false);
    }
  }, [warehouseName, warehouseAddress]);

  // --- Step 2: Apply Template ---

  const handleApplyTemplate = useCallback(async () => {
    if (!warehouse || !selectedTemplate) return;
    const tpl = TEMPLATES[selectedTemplate];
    if (!tpl || tpl.locations.length === 0) {
      setStep(3);
      return;
    }

    setIsLoading(true);
    try {
      let created = 0;
      for (const loc of tpl.locations) {
        await api.post(`/warehouses/${warehouse.id}/locations`, {
          name: loc.name,
          location_type: loc.type,
        });
        created++;
      }
      setLocationsCreated(created);
      toast.success(`${created} ubicaciones creadas`);
      setStep(3);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear ubicaciones');
    } finally {
      setIsLoading(false);
    }
  }, [warehouse, selectedTemplate]);

  // --- Step 3: Products ---

  const handleProductNameChange = (index: number, name: string) => {
    setProducts((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], name, sku: name ? generateSku(name) : '' };
      return next;
    });
  };

  const handleProductSkuChange = (index: number, sku: string) => {
    setProducts((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], sku };
      return next;
    });
  };

  const handleProductUnitChange = (index: number, unit: UnitType) => {
    setProducts((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], unit_of_measure: unit };
      return next;
    });
  };

  const addProduct = () => {
    if (products.length >= 3) return;
    setProducts((prev) => [
      ...prev,
      { id: createId(), name: '', sku: '', unit_of_measure: 'piece' },
    ]);
  };

  const removeProduct = (index: number) => {
    setProducts((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCreateProducts = useCallback(async () => {
    const valid = products.filter((p) => p.name.trim() && p.sku.trim());
    if (valid.length === 0) {
      setStep(4);
      return;
    }

    setIsLoading(true);
    try {
      let created = 0;
      for (const p of valid) {
        await api.post('/products', {
          name: p.name.trim(),
          sku: p.sku.trim(),
          unit_of_measure: p.unit_of_measure,
          min_stock: 0,
        });
        created++;
      }
      setProductsCreated(created);
      toast.success(`${created} producto${created > 1 ? 's' : ''} creado${created > 1 ? 's' : ''}`);
      setStep(4);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear productos');
    } finally {
      setIsLoading(false);
    }
  }, [products]);

  // --- Step 4: Invites ---

  const handleSendInvite = useCallback(async () => {
    if (!inviteEmail.trim() || !inviteName.trim()) return;
    setIsLoading(true);
    try {
      const res = await api.post<CreateUserResponse>('/users', {
        email: inviteEmail.trim(),
        name: inviteName.trim(),
        role: inviteRole,
      });
      setInvites((prev) => [
        ...prev,
        {
          id: createId(),
          email: inviteEmail.trim(),
          name: inviteName.trim(),
          role: inviteRole,
          sent: true,
        },
      ]);
      setInviteEmail('');
      setInviteName('');
      setInviteRole('operator');
      if (res.invite_code) {
        setInviteCodeToShow(res.invite_code);
        toast.success('Usuario creado', {
          description: 'Copia el codigo de activacion que aparece abajo',
          duration: 5000,
        });
      } else {
        toast.success('Usuario creado');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al invitar usuario');
    } finally {
      setIsLoading(false);
    }
  }, [inviteEmail, inviteName, inviteRole]);

  const handleFinish = () => {
    router.push('/inicio');
  };

  // --- Render ---

  return (
    <div
      className="mx-auto max-w-2xl py-6 px-4 sm:py-10"
      data-testid="onboarding-page"
    >
      {/* Progress Bar */}
      <div className="mb-8" data-testid="onboarding-progress">
        <div className="flex items-center justify-between mb-2">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => {
            const s = i + 1;
            const isActive = s === step;
            const isDone = s < step;
            return (
              <div
                key={s}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors',
                  isDone && 'bg-primary text-primary-foreground',
                  isActive && 'bg-primary text-primary-foreground ring-4 ring-primary/20',
                  !isDone && !isActive && 'bg-muted text-muted-foreground'
                )}
              >
                {isDone ? (
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} />
                ) : (
                  s
                )}
              </div>
            );
          })}
        </div>
        <div className="relative h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${((step - 1) / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </div>

      {/* Step Content */}
      <div className="transition-opacity duration-300">
        {step === 1 && (
          <StepWarehouse
            warehouseName={warehouseName}
            warehouseAddress={warehouseAddress}
            onNameChange={setWarehouseName}
            onAddressChange={setWarehouseAddress}
            onSubmit={handleCreateWarehouse}
            isLoading={isLoading}
          />
        )}

        {step === 2 && (
          <StepTemplate
            selectedTemplate={selectedTemplate}
            onSelect={setSelectedTemplate}
            onSubmit={handleApplyTemplate}
            onSkip={() => setStep(3)}
            isLoading={isLoading}
          />
        )}

        {step === 3 && (
          <StepProducts
            products={products}
            onNameChange={handleProductNameChange}
            onSkuChange={handleProductSkuChange}
            onUnitChange={handleProductUnitChange}
            onAdd={addProduct}
            onRemove={removeProduct}
            onSubmit={handleCreateProducts}
            onSkip={() => setStep(4)}
            isLoading={isLoading}
          />
        )}

        {step === 4 && (
          <StepInvite
            inviteEmail={inviteEmail}
            inviteName={inviteName}
            inviteRole={inviteRole}
            invites={invites}
            onEmailChange={setInviteEmail}
            onNameChange={setInviteName}
            onRoleChange={setInviteRole}
            onSend={handleSendInvite}
            onFinish={() => setStep(5)}
            isLoading={isLoading}
            inviteCodeToShow={inviteCodeToShow}
            onDismissCode={() => setInviteCodeToShow(null)}
          />
        )}

        {step === 5 && (
          <StepDone
            locationsCreated={locationsCreated}
            productsCreated={productsCreated}
            usersInvited={invites.length}
            onGo={handleFinish}
          />
        )}
      </div>
    </div>
  );
}

// --- Step Sub-Components ---

function StepWarehouse({
  warehouseName,
  warehouseAddress,
  onNameChange,
  onAddressChange,
  onSubmit,
  isLoading,
}: {
  warehouseName: string;
  warehouseAddress: string;
  onNameChange: (v: string) => void;
  onAddressChange: (v: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
}) {
  return (
    <Card data-testid="step-warehouse">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <HugeiconsIcon icon={Store01Icon} size={20} className="text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Tu almacén</CardTitle>
            <CardDescription>
              Comienza dando un nombre a tu espacio de trabajo
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="warehouse-name">Nombre del almacén</Label>
          <Input
            id="warehouse-name"
            data-testid="input-warehouse-name"
            placeholder='Ej: "Herrería Los García"'
            value={warehouseName}
            onChange={(e) => onNameChange(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="warehouse-address">
            Dirección <span className="text-muted-foreground font-normal">(opcional)</span>
          </Label>
          <Input
            id="warehouse-address"
            data-testid="input-warehouse-address"
            placeholder="Calle, número, colonia..."
            value={warehouseAddress}
            onChange={(e) => onAddressChange(e.target.value)}
          />
        </div>
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          data-testid="btn-create-warehouse"
          onClick={onSubmit}
          disabled={!warehouseName.trim() || isLoading}
        >
          {isLoading ? 'Creando...' : 'Continuar'}
        </Button>
      </CardFooter>
    </Card>
  );
}

function StepTemplate({
  selectedTemplate,
  onSelect,
  onSubmit,
  onSkip,
  isLoading,
}: {
  selectedTemplate: string | null;
  onSelect: (key: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
  isLoading: boolean;
}) {
  return (
    <Card data-testid="step-template">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <HugeiconsIcon icon={SparklesIcon} size={20} className="text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Organiza tu espacio</CardTitle>
            <CardDescription>
              Elige una plantilla y crearemos las ubicaciones por ti
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Object.entries(TEMPLATES).map(([key, tpl]) => {
            const isSelected = selectedTemplate === key;
            return (
              <button
                key={key}
                type="button"
                data-testid={`template-${key}`}
                onClick={() => onSelect(key)}
                className={cn(
                  'flex items-start gap-3 rounded-2xl border p-4 text-left transition-all',
                  'hover:bg-muted/50',
                  isSelected
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                    : 'border-border'
                )}
              >
                <div
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors',
                    isSelected ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                  )}
                >
                  <HugeiconsIcon icon={tpl.icon} size={18} />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm">{tpl.name}</p>
                  {tpl.locations.length > 0 ? (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {tpl.locations.length} ubicaciones
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Crea las tuyas después
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
      <CardFooter className="justify-between">
        <Button
          variant="ghost"
          data-testid="btn-skip-template"
          onClick={onSkip}
        >
          Saltar
        </Button>
        <Button
          data-testid="btn-apply-template"
          onClick={onSubmit}
          disabled={!selectedTemplate || isLoading}
        >
          {isLoading ? 'Creando ubicaciones...' : 'Aplicar plantilla'}
        </Button>
      </CardFooter>
    </Card>
  );
}

function StepProducts({
  products,
  onNameChange,
  onSkuChange,
  onUnitChange,
  onAdd,
  onRemove,
  onSubmit,
  onSkip,
  isLoading,
}: {
  products: ProductDraft[];
  onNameChange: (i: number, v: string) => void;
  onSkuChange: (i: number, v: string) => void;
  onUnitChange: (i: number, v: UnitType) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  onSubmit: () => void;
  onSkip: () => void;
  isLoading: boolean;
}) {
  return (
    <Card data-testid="step-products">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <HugeiconsIcon icon={Package01Icon} size={20} className="text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Tu primer producto</CardTitle>
            <CardDescription>
              Agrega hasta 3 productos para empezar
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {products.map((product, i) => (
          <div
            key={product.id}
            className="space-y-3 rounded-xl border border-border p-4"
            data-testid={`product-form-${i}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                Producto {i + 1}
              </span>
              {products.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onRemove(i)}
                  data-testid={`btn-remove-product-${i}`}
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={14} />
                </Button>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`product-name-${i}`}>Nombre</Label>
              <Input
                id={`product-name-${i}`}
                data-testid={`input-product-name-${i}`}
                placeholder='Ej: "Tubo PTR 2 pulgadas"'
                value={product.name}
                onChange={(e) => onNameChange(i, e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor={`product-sku-${i}`}>SKU</Label>
                <Input
                  id={`product-sku-${i}`}
                  data-testid={`input-product-sku-${i}`}
                  placeholder="AUTO"
                  value={product.sku}
                  onChange={(e) => onSkuChange(i, e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Unidad</Label>
                <Select
                  value={product.unit_of_measure}
                  onValueChange={(v) => onUnitChange(i, v as UnitType)}
                >
                  <SelectTrigger
                    className="w-full"
                    data-testid={`select-product-unit-${i}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNIT_OPTIONS.map((u) => (
                      <SelectItem key={u.value} value={u.value}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        ))}

        {products.length < 3 && (
          <Button
            variant="outline"
            className="w-full"
            onClick={onAdd}
            data-testid="btn-add-product"
          >
            <HugeiconsIcon icon={Add01Icon} size={16} data-icon="inline-start" />
            Agregar otro
          </Button>
        )}
      </CardContent>
      <CardFooter className="justify-between">
        <Button
          variant="ghost"
          data-testid="btn-skip-products"
          onClick={onSkip}
        >
          Saltar este paso
        </Button>
        <Button
          data-testid="btn-create-products"
          onClick={onSubmit}
          disabled={isLoading}
        >
          {isLoading ? 'Guardando...' : 'Continuar'}
        </Button>
      </CardFooter>
    </Card>
  );
}

function StepInvite({
  inviteEmail,
  inviteName,
  inviteRole,
  invites,
  onEmailChange,
  onNameChange,
  onRoleChange,
  onSend,
  onFinish,
  isLoading,
  inviteCodeToShow,
  onDismissCode,
}: {
  inviteEmail: string;
  inviteName: string;
  inviteRole: 'warehouse_manager' | 'operator';
  invites: InviteDraft[];
  onEmailChange: (v: string) => void;
  onNameChange: (v: string) => void;
  onRoleChange: (v: 'warehouse_manager' | 'operator') => void;
  onSend: () => void;
  onFinish: () => void;
  isLoading: boolean;
  inviteCodeToShow: string | null;
  onDismissCode: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!inviteCodeToShow) return;
    navigator.clipboard.writeText(inviteCodeToShow).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <Card data-testid="step-invite">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <HugeiconsIcon icon={UserAdd01Icon} size={20} className="text-primary" />
          </div>
          <div>
            <CardTitle className="text-lg">Invita a tu equipo</CardTitle>
            <CardDescription>
              Tus empleados podrán registrar entradas y salidas desde su celular
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="space-y-2">
            <Label htmlFor="invite-name">Nombre</Label>
            <Input
              id="invite-name"
              data-testid="input-invite-name"
              placeholder="Nombre del empleado"
              value={inviteName}
              onChange={(e) => onNameChange(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              data-testid="input-invite-email"
              type="email"
              placeholder="correo@ejemplo.com"
              value={inviteEmail}
              onChange={(e) => onEmailChange(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Rol</Label>
            <Select
              value={inviteRole}
              onValueChange={(v) => onRoleChange(v as 'warehouse_manager' | 'operator')}
            >
              <SelectTrigger className="w-full" data-testid="select-invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="warehouse_manager">Jefe de almacén</SelectItem>
                <SelectItem value="operator">Operador</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            className="w-full"
            variant="outline"
            data-testid="btn-send-invite"
            onClick={onSend}
            disabled={!inviteEmail.trim() || !inviteName.trim() || isLoading}
          >
            <HugeiconsIcon icon={Mail01Icon} size={16} data-icon="inline-start" />
            {isLoading ? 'Enviando...' : 'Invitar'}
          </Button>
        </div>

        {inviteCodeToShow && (
          <div
            className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 space-y-3"
            data-testid="invite-code-banner"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-0.5">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  Codigo de activacion generado
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Comparte este codigo con el usuario para que active su cuenta. Solo se muestra una vez.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={onDismissCode}
                data-testid="btn-dismiss-code"
                className="text-amber-700 hover:text-amber-900 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40 shrink-0"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={14} />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 rounded-lg bg-white dark:bg-black/30 border border-amber-200 dark:border-amber-800 px-3 py-2 text-sm font-mono tracking-widest text-amber-900 dark:text-amber-100 select-all overflow-x-auto"
                data-testid="invite-code-value"
              >
                {inviteCodeToShow}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                data-testid="btn-copy-code"
                className="shrink-0 border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40"
              >
                {copied ? 'Copiado' : 'Copiar'}
              </Button>
            </div>
          </div>
        )}

        {invites.length > 0 && (
          <div className="space-y-2" data-testid="invite-list">
            <p className="text-sm font-medium text-muted-foreground">Invitados</p>
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-2"
              >
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  size={16}
                  className="text-emerald-500 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{inv.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{inv.email}</p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {inv.role === 'warehouse_manager' ? 'Jefe' : 'Operador'}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <CardFooter className="justify-between">
        <Button
          variant="ghost"
          data-testid="btn-skip-invite"
          onClick={onFinish}
        >
          {invites.length > 0 ? 'Continuar' : 'Saltar este paso'}
        </Button>
        {invites.length > 0 && (
          <Button data-testid="btn-finish-invite" onClick={onFinish}>
            Continuar
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function StepDone({
  locationsCreated,
  productsCreated,
  usersInvited,
  onGo,
}: {
  locationsCreated: number;
  productsCreated: number;
  usersInvited: number;
  onGo: () => void;
}) {
  const items = [
    locationsCreated > 0 && `${locationsCreated} ubicaciones`,
    productsCreated > 0 && `${productsCreated} productos`,
    usersInvited > 0 && `${usersInvited} usuarios invitados`,
  ].filter(Boolean);

  return (
    <Card data-testid="step-done">
      <CardContent className="py-10 text-center space-y-4">
        <div className="flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30">
            <HugeiconsIcon icon={RocketIcon} size={32} className="text-emerald-600 dark:text-emerald-400" />
          </div>
        </div>
        <div>
          <h2 className="text-xl font-bold">Tu almacén está configurado</h2>
          <p className="text-muted-foreground mt-1">
            Todo listo para empezar a controlar tu inventario
          </p>
        </div>
        {items.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {items.map((item) => (
              <span
                key={item as string}
                className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium"
              >
                {item}
              </span>
            ))}
          </div>
        )}
        <Button size="lg" data-testid="btn-go-dashboard" onClick={onGo}>
          Ir al dashboard
        </Button>
        <div className="space-y-2 mt-4">
          <p className="text-sm text-muted-foreground">¿Que sigue?</p>
          <div className="flex flex-col gap-2">
            <Link href="/movimientos" className="text-primary text-sm hover:underline">
              → Registrar tu primera entrada de material
            </Link>
            <Link href="/inventario" className="text-primary text-sm hover:underline">
              → Ver tu inventario
            </Link>
            <Link href="/almacenes" className="text-primary text-sm hover:underline">
              → Administrar tu almacen
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
