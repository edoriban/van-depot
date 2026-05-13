'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { api } from '@/lib/api-mutations';
import { useAuthStore } from '@/stores/auth-store';
import type { User, UserRole, Warehouse, PaginatedResponse, CreateUserResponse } from '@/types';
import { DataTable, type ColumnDef } from '@/components/shared/data-table';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Badge } from '@/components/ui/badge';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

const ROLE_LABELS: Record<UserRole, string> = {
  superadmin: 'Super Admin',
  owner: 'Propietario',
  warehouse_manager: 'Jefe de almacen',
  operator: 'Operador',
};

const ROLE_COLORS: Record<UserRole, string> = {
  superadmin: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  owner: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  warehouse_manager: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  operator: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
};

interface UserWithWarehouses extends User {
  warehouses?: Warehouse[];
  warehouse_count?: number;
}

const PER_PAGE = 20;

export default function UsersPage() {
  const currentUser = useAuthStore((s) => s.user);

  const [users, setUsers] = useState<UserWithWarehouses[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reference data
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  // Create/Edit dialog
  const [formOpen, setFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserWithWarehouses | null>(null);
  const [formEmail, setFormEmail] = useState('');
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState<UserRole>('operator');
  const [formIsActive, setFormIsActive] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Invite code dialog (shown after creating a new user)
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<UserWithWarehouses | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Password dialog
  const [passwordTarget, setPasswordTarget] = useState<UserWithWarehouses | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Warehouse assignment dialog
  const [warehouseTarget, setWarehouseTarget] = useState<UserWithWarehouses | null>(null);
  const [assignedWarehouses, setAssignedWarehouses] = useState<Warehouse[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);

  // Check admin access
  const isAdmin =
    currentUser?.role === 'superadmin' || currentUser?.role === 'owner';

  // Fetch warehouses
  useEffect(() => {
    api
      .get<Warehouse[] | PaginatedResponse<Warehouse>>('/warehouses')
      .then((res) => {
        setWarehouses(Array.isArray(res) ? res : res.data);
      })
      .catch(() => {});
  }, []);

  const fetchUsers = useCallback(async (p: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<PaginatedResponse<UserWithWarehouses>>(
        `/users?page=${p}&per_page=${PER_PAGE}`
      );
      setUsers(res.data);
      setTotal(res.total);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Error al cargar usuarios'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers(page);
  }, [page, fetchUsers]);

  // --- Create/Edit ---
  const openCreateDialog = () => {
    setEditingUser(null);
    setFormEmail('');
    setFormName('');
    setFormRole('operator');
    setFormIsActive(true);
    setFormOpen(true);
  };

  const openEditDialog = (u: UserWithWarehouses) => {
    setEditingUser(u);
    setFormEmail(u.email);
    setFormName(u.name);
    setFormRole(u.role ?? 'operator');
    setFormIsActive(u.is_active);
    setFormOpen(true);
  };

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      if (editingUser) {
        await api.put(`/users/${editingUser.id}`, {
          name: formName,
          role: formRole,
          is_active: formIsActive,
        });
        toast.success('Usuario actualizado');
        setFormOpen(false);
        fetchUsers(page);
      } else {
        const res = await api.post<CreateUserResponse>('/users', {
          email: formEmail,
          name: formName,
          role: formRole,
        });
        toast.success('Usuario creado');
        setFormOpen(false);
        fetchUsers(1);
        setPage(1);
        if (res.invite_code) {
          setInviteCode(res.invite_code);
          setCopiedCode(false);
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setIsSaving(false);
    }
  };

  // --- Delete ---
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await api.del(`/users/${deleteTarget.id}`);
      toast.success('Usuario eliminado');
      setDeleteTarget(null);
      fetchUsers(page);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar');
    } finally {
      setIsDeleting(false);
    }
  };

  // --- Password ---
  const handleChangePassword = async () => {
    if (!passwordTarget || !newPassword) return;
    setIsChangingPassword(true);
    try {
      await api.put(`/users/${passwordTarget.id}/password`, {
        password: newPassword,
      });
      toast.success('Contrasena actualizada');
      setPasswordTarget(null);
      setNewPassword('');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al cambiar contrasena'
      );
    } finally {
      setIsChangingPassword(false);
    }
  };

  // --- Warehouse Assignment ---
  const openWarehouseDialog = async (u: UserWithWarehouses) => {
    setWarehouseTarget(u);
    setSelectedWarehouseId('');
    try {
      const res = await api.get<Warehouse[]>(
        `/users/${u.id}/warehouses`
      );
      setAssignedWarehouses(Array.isArray(res) ? res : []);
    } catch {
      setAssignedWarehouses([]);
    }
  };

  const handleAssignWarehouse = async () => {
    if (!warehouseTarget || !selectedWarehouseId) return;
    setIsAssigning(true);
    try {
      await api.post(
        `/users/${warehouseTarget.id}/warehouses/${selectedWarehouseId}`
      );
      toast.success('Almacen asignado');
      const res = await api.get<Warehouse[]>(
        `/users/${warehouseTarget.id}/warehouses`
      );
      setAssignedWarehouses(Array.isArray(res) ? res : []);
      setSelectedWarehouseId('');
      fetchUsers(page);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al asignar almacen'
      );
    } finally {
      setIsAssigning(false);
    }
  };

  const handleRemoveWarehouse = async (warehouseId: string) => {
    if (!warehouseTarget) return;
    try {
      await api.del(
        `/users/${warehouseTarget.id}/warehouses/${warehouseId}`
      );
      toast.success('Almacen removido');
      setAssignedWarehouses((prev) =>
        prev.filter((w) => w.id !== warehouseId)
      );
      fetchUsers(page);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Error al remover almacen'
      );
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-16" data-testid="users-page">
        <p className="text-muted-foreground">
          No tienes permisos para acceder a esta seccion.
        </p>
      </div>
    );
  }

  const columns: ColumnDef<UserWithWarehouses>[] = [
    {
      key: 'name',
      header: 'Nombre',
      render: (u) => <span className="font-medium">{u.name}</span>,
    },
    {
      key: 'email',
      header: 'Email',
      render: (u) => u.email,
    },
    {
      key: 'role',
      header: 'Rol',
      render: (u) => (
        <Badge className={ROLE_COLORS[u.role ?? 'operator']} data-testid="user-role-badge">
          {ROLE_LABELS[u.role ?? 'operator']}
        </Badge>
      ),
    },
    {
      key: 'warehouses',
      header: 'Almacenes',
      render: (u) => {
        const count = u.warehouse_count ?? u.warehouses?.length ?? 0;
        return (
          <span className="text-muted-foreground" data-testid="user-warehouse-count">
            {count} almacen{count !== 1 ? 'es' : ''}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Estado',
      render: (u) => (
        <div className="flex flex-col gap-1">
          <Badge variant={u.is_active ? 'default' : 'secondary'} data-testid="user-status-badge">
            {u.is_active ? 'Activo' : 'Inactivo'}
          </Badge>
          {u.must_set_password && (
            <Badge
              className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
              data-testid="user-pending-activation-badge"
            >
              Pendiente activacion
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (u) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              data-testid="user-actions-btn"
              className="size-8 p-0"
            >
              <span className="sr-only">Abrir menu</span>
              <span className="text-lg leading-none">...</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => openEditDialog(u)}
              data-testid="edit-user-btn"
            >
              Editar
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setPasswordTarget(u);
                setNewPassword('');
              }}
              data-testid="change-password-btn"
            >
              Cambiar contrasena
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => openWarehouseDialog(u)}
              data-testid="assign-warehouse-btn"
            >
              Asignar almacenes
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setDeleteTarget(u)}
              className="text-destructive focus:text-destructive"
              data-testid="delete-user-btn"
            >
              Eliminar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-6" data-testid="users-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Usuarios</h1>
          <p className="text-muted-foreground mt-1">
            Gestiona los usuarios y sus permisos
          </p>
        </div>
        <Button onClick={openCreateDialog} data-testid="new-user-btn">
          Nuevo usuario
        </Button>
      </div>

      {error && (
        <div className="rounded-4xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <DataTable
        columns={columns}
        data={users}
        total={total}
        page={page}
        perPage={PER_PAGE}
        onPageChange={setPage}
        isLoading={isLoading}
        emptyMessage="No hay usuarios registrados"
      />

      {/* Create/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingUser ? 'Editar usuario' : 'Nuevo usuario'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!editingUser && (
              <div className="space-y-2">
                <Label htmlFor="user-email">Email</Label>
                <Input
                  id="user-email"
                  name="email"
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="correo@ejemplo.com"
                  required
                  data-testid="user-email-input"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="user-name">Nombre</Label>
              <Input
                id="user-name"
                name="name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Nombre del usuario"
                required
                data-testid="user-name-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-role">Rol</Label>
              <Select
                value={formRole}
                onValueChange={(val) => setFormRole(val as UserRole)}
              >
                <SelectTrigger data-testid="user-role-select" className="w-full">
                  <SelectValue placeholder="Seleccionar rol" />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.entries(ROLE_LABELS) as [UserRole, string][]
                  ).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {editingUser && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="user-active"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="size-4 rounded border-zinc-300"
                  data-testid="user-active-toggle"
                />
                <Label htmlFor="user-active" className="cursor-pointer">
                  Usuario activo
                </Label>
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
                disabled={isSaving}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSaving}
                data-testid="submit-user-btn"
              >
                {isSaving
                  ? 'Guardando...'
                  : editingUser
                    ? 'Actualizar'
                    : 'Crear'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Eliminar usuario"
        description={`Se eliminara el usuario "${deleteTarget?.name}" (${deleteTarget?.email}). Esta accion no se puede deshacer.`}
        onConfirm={handleDelete}
        isLoading={isDeleting}
      />

      {/* Password Dialog */}
      <Dialog
        open={!!passwordTarget}
        onOpenChange={(open) => !open && setPasswordTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Cambiar contrasena de {passwordTarget?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">Nueva contrasena</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Nueva contrasena"
                minLength={6}
                data-testid="new-password-input"
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setPasswordTarget(null)}
                disabled={isChangingPassword}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleChangePassword}
                disabled={isChangingPassword || !newPassword}
                data-testid="submit-password-btn"
              >
                {isChangingPassword ? 'Guardando...' : 'Cambiar contrasena'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Warehouse Assignment Dialog */}
      <Dialog
        open={!!warehouseTarget}
        onOpenChange={(open) => !open && setWarehouseTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Almacenes de {warehouseTarget?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Current assignments */}
            <div className="space-y-2">
              <Label>Almacenes asignados</Label>
              {assignedWarehouses.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Sin almacenes asignados
                </p>
              ) : (
                <div className="space-y-2">
                  {assignedWarehouses.map((w) => (
                    <div
                      key={w.id}
                      className="flex items-center justify-between rounded-lg border p-2"
                    >
                      <span className="text-sm">{w.name}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => handleRemoveWarehouse(w.id)}
                        data-testid="remove-warehouse-btn"
                      >
                        Remover
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add assignment */}
            <div className="space-y-2">
              <Label>Asignar almacen</Label>
              <div className="flex items-center gap-2">
                <Select
                  value={selectedWarehouseId || undefined}
                  onValueChange={setSelectedWarehouseId}
                >
                  <SelectTrigger data-testid="assign-warehouse-select" className="flex-1">
                    <SelectValue placeholder="Seleccionar almacen" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.reduce<ReactNode[]>((acc, w) => {
                      if (assignedWarehouses.some((aw) => aw.id === w.id)) return acc;
                      acc.push(
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>,
                      );
                      return acc;
                    }, [])}
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleAssignWarehouse}
                  disabled={isAssigning || !selectedWarehouseId}
                  data-testid="confirm-assign-btn"
                >
                  {isAssigning ? '...' : 'Asignar'}
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setWarehouseTarget(null)}
              >
                Cerrar
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Invite Code Dialog */}
      <Dialog open={!!inviteCode} onOpenChange={(open) => !open && setInviteCode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Codigo de activacion</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Comparte este codigo con el usuario para que active su cuenta en{' '}
              <span className="font-medium">/activar</span>. Solo se muestra una vez.
            </p>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 rounded-lg bg-muted border border-border px-3 py-2 text-sm font-mono tracking-widest select-all overflow-x-auto"
                data-testid="dialog-invite-code-value"
              >
                {inviteCode}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!inviteCode) return;
                  navigator.clipboard.writeText(inviteCode).then(() => {
                    setCopiedCode(true);
                    setTimeout(() => setCopiedCode(false), 2000);
                  });
                }}
                data-testid="btn-copy-invite-code"
              >
                {copiedCode ? 'Copiado' : 'Copiar'}
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => setInviteCode(null)}>Cerrar</Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
