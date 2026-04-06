# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: products.spec.ts >> Categories >> can edit a category
- Location: e2e/products.spec.ts:127:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-slot="table-container"]').getByText('Categoria Editada E2E 1775451782790')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('[data-slot="table-container"]').getByText('Categoria Editada E2E 1775451782790')

```

# Page snapshot

```yaml
- generic [active]:
  - generic:
    - generic:
      - generic:
        - generic:
          - generic:
            - generic:
              - img
              - generic: VanDepot
          - generic:
            - generic:
              - generic: Navegacion
              - generic:
                - list:
                  - listitem:
                    - link:
                      - /url: /dashboard
                      - img
                      - generic: Dashboard
                  - listitem:
                    - link:
                      - /url: /almacenes
                      - img
                      - generic: Almacenes
                  - listitem:
                    - link:
                      - /url: /ubicaciones
                      - img
                      - generic: Ubicaciones
                  - listitem:
                    - link:
                      - /url: /productos
                      - img
                      - generic: Productos
                  - listitem:
                    - link:
                      - /url: /categorias
                      - img
                      - generic: Categorias
                  - listitem:
                    - link:
                      - /url: /proveedores
                      - img
                      - generic: Proveedores
                  - listitem:
                    - link:
                      - /url: /movements
                      - img
                      - generic: Movimientos
                  - listitem:
                    - link:
                      - /url: /inventory
                      - img
                      - generic: Inventario
                  - listitem:
                    - link:
                      - /url: /cycle-counts
                      - img
                      - generic: Conteos
            - generic:
              - generic: Administracion
              - generic:
                - list:
                  - listitem:
                    - link:
                      - /url: /users
                      - img
                      - generic: Usuarios
          - generic:
            - generic:
              - generic:
                - generic: admin
                - generic: superadmin
              - button:
                - img
    - main:
      - generic:
        - button:
          - img
          - generic: Toggle Sidebar
      - main:
        - generic:
          - generic:
            - generic:
              - heading [level=1]: Categorias
              - paragraph: Gestiona las categorias de productos
            - button: Nueva categoria
          - generic: Entity not found
          - generic:
            - generic:
              - generic:
                - table:
                  - rowgroup:
                    - row:
                      - columnheader: Nombre
                      - columnheader: Padre
                      - columnheader: Acciones
                  - rowgroup:
                    - row:
                      - cell: Categoria Editada E2E 1775451459239
                      - cell: —
                      - cell:
                        - generic:
                          - button: Editar
                          - button: Eliminar
  - region "Notifications alt+T"
  - button "Open Next.js Dev Tools" [ref=e6] [cursor=pointer]:
    - img [ref=e7]
  - alert
  - dialog "Editar categoria" [ref=e11]:
    - heading "Editar categoria" [level=2] [ref=e13]
    - generic [ref=e14]:
      - generic [ref=e15]:
        - generic [ref=e16]: Nombre
        - textbox "Nombre" [ref=e17]:
          - /placeholder: Nombre de la categoria
          - text: Categoria Editada E2E 1775451782790
      - generic [ref=e18]:
        - generic [ref=e19]: Categoria padre
        - combobox "Categoria padre" [ref=e20]:
          - option "Sin categoria padre" [selected]
      - generic [ref=e21]:
        - button "Cancelar" [ref=e22]
        - button "Actualizar" [ref=e23]
    - button "Close" [ref=e24]:
      - img
      - generic [ref=e25]: Close
```

# Test source

```ts
  48  | 
  49  |   test('can edit a product', async ({ page }) => {
  50  |     await page.goto('/productos');
  51  |     // Wait for page to load - either table with data or empty state
  52  |     await expect(page.getByRole('heading', { level: 1, name: 'Productos' })).toBeVisible({ timeout: 10000 });
  53  | 
  54  |     // Wait for loading to finish
  55  |     const editBtn = page.getByTestId('edit-product-btn').first();
  56  |     // Skip if no products exist
  57  |     if (!(await editBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
  58  |       test.skip();
  59  |       return;
  60  |     }
  61  | 
  62  |     await editBtn.click({ force: true });
  63  |     await expect(page.getByTestId('product-name-input')).toBeVisible();
  64  | 
  65  |     const uniqueName = `Producto Editado E2E ${Date.now()}`;
  66  |     const nameInput = page.getByTestId('product-name-input');
  67  |     await nameInput.clear();
  68  |     await nameInput.fill(uniqueName);
  69  |     await page.getByTestId('submit-btn').click({ force: true });
  70  | 
  71  |     await expect(
  72  |       page.locator('[data-slot="table-container"]').getByText(uniqueName)
  73  |     ).toBeVisible({ timeout: 10000 });
  74  |   });
  75  | 
  76  |   test('can delete a product', async ({ page }) => {
  77  |     await page.goto('/productos');
  78  |     await expect(page.getByRole('heading', { level: 1, name: 'Productos' })).toBeVisible({ timeout: 10000 });
  79  | 
  80  |     const deleteBtn = page.getByTestId('delete-product-btn').first();
  81  |     if (!(await deleteBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
  82  |       test.skip();
  83  |       return;
  84  |     }
  85  | 
  86  |     await deleteBtn.click({ force: true });
  87  |     await page.getByTestId('confirm-delete-btn').click({ force: true });
  88  | 
  89  |     // After deletion, either the table or empty state should be visible
  90  |     await expect(
  91  |       page.locator('[data-slot="table-container"]')
  92  |     ).toBeVisible({ timeout: 10000 });
  93  |   });
  94  | 
  95  |   test('shows empty state when no products exist', async ({ page }) => {
  96  |     await page.goto('/productos');
  97  |     await expect(page.getByRole('heading', { level: 1, name: 'Productos' })).toBeVisible({ timeout: 10000 });
  98  |   });
  99  | });
  100 | 
  101 | test.describe('Categories', () => {
  102 |   test.beforeEach(async ({ page }) => {
  103 |     await login(page);
  104 |   });
  105 | 
  106 |   test('can navigate to categories page', async ({ page }) => {
  107 |     await page.getByRole('link', { name: 'Categorias' }).click({ force: true });
  108 |     await expect(page).toHaveURL(/.*categorias/);
  109 |     await expect(page.getByRole('heading', { level: 1, name: 'Categorias' })).toBeVisible({ timeout: 10000 });
  110 |   });
  111 | 
  112 |   test('can create a category', async ({ page }) => {
  113 |     await page.goto('/categorias');
  114 |     await expect(page.getByRole('heading', { level: 1, name: 'Categorias' })).toBeVisible({ timeout: 10000 });
  115 |     await page.getByTestId('new-category-btn').click({ force: true });
  116 |     await expect(page.getByTestId('category-name-input')).toBeVisible();
  117 | 
  118 |     const uniqueName = `Categoria Test E2E ${Date.now()}`;
  119 |     await page.getByTestId('category-name-input').fill(uniqueName);
  120 |     await page.getByTestId('submit-btn').click({ force: true });
  121 | 
  122 |     await expect(
  123 |       page.locator('[data-slot="table-container"]').getByText(uniqueName)
  124 |     ).toBeVisible({ timeout: 10000 });
  125 |   });
  126 | 
  127 |   test('can edit a category', async ({ page }) => {
  128 |     await page.goto('/categorias');
  129 |     await expect(page.getByRole('heading', { level: 1, name: 'Categorias' })).toBeVisible({ timeout: 10000 });
  130 | 
  131 |     const editBtn = page.getByTestId('edit-category-btn').first();
  132 |     if (!(await editBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
  133 |       test.skip();
  134 |       return;
  135 |     }
  136 | 
  137 |     await editBtn.click({ force: true });
  138 |     await expect(page.getByTestId('category-name-input')).toBeVisible();
  139 | 
  140 |     const uniqueName = `Categoria Editada E2E ${Date.now()}`;
  141 |     const nameInput = page.getByTestId('category-name-input');
  142 |     await nameInput.clear();
  143 |     await nameInput.fill(uniqueName);
  144 |     await page.getByTestId('submit-btn').click({ force: true });
  145 | 
  146 |     await expect(
  147 |       page.locator('[data-slot="table-container"]').getByText(uniqueName)
> 148 |     ).toBeVisible({ timeout: 10000 });
      |       ^ Error: expect(locator).toBeVisible() failed
  149 |   });
  150 | 
  151 |   test('can delete a category', async ({ page }) => {
  152 |     await page.goto('/categorias');
  153 |     await expect(page.getByRole('heading', { level: 1, name: 'Categorias' })).toBeVisible({ timeout: 10000 });
  154 | 
  155 |     const deleteBtn = page.getByTestId('delete-category-btn').first();
  156 |     if (!(await deleteBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
  157 |       test.skip();
  158 |       return;
  159 |     }
  160 | 
  161 |     await deleteBtn.click({ force: true });
  162 |     await page.getByTestId('confirm-delete-btn').click({ force: true });
  163 | 
  164 |     await expect(
  165 |       page.locator('[data-slot="table-container"]')
  166 |     ).toBeVisible({ timeout: 10000 });
  167 |   });
  168 | });
  169 | 
  170 | test.describe('Suppliers', () => {
  171 |   test.beforeEach(async ({ page }) => {
  172 |     await login(page);
  173 |   });
  174 | 
  175 |   test('can navigate to suppliers page', async ({ page }) => {
  176 |     await page.getByRole('link', { name: 'Proveedores' }).click({ force: true });
  177 |     await expect(page).toHaveURL(/.*proveedores/);
  178 |     await expect(page.getByRole('heading', { level: 1, name: 'Proveedores' })).toBeVisible({ timeout: 10000 });
  179 |   });
  180 | 
  181 |   test('can create a supplier', async ({ page }) => {
  182 |     await page.goto('/proveedores');
  183 |     await expect(page.getByRole('heading', { level: 1, name: 'Proveedores' })).toBeVisible({ timeout: 10000 });
  184 |     await page.getByTestId('new-supplier-btn').click({ force: true });
  185 |     await expect(page.getByTestId('supplier-name-input')).toBeVisible();
  186 | 
  187 |     const uniqueName = `Proveedor Test E2E ${Date.now()}`;
  188 |     await page.getByTestId('supplier-name-input').fill(uniqueName);
  189 |     await page.getByTestId('supplier-contact-input').fill('Juan Perez');
  190 |     await page.getByTestId('supplier-phone-input').fill('5551234567');
  191 |     await page.getByTestId('supplier-email-input').fill('test@proveedor.mx');
  192 |     await page.getByTestId('submit-btn').click({ force: true });
  193 | 
  194 |     await expect(
  195 |       page.locator('[data-slot="table-container"]').getByText(uniqueName)
  196 |     ).toBeVisible({ timeout: 10000 });
  197 |   });
  198 | 
  199 |   test('can edit a supplier', async ({ page }) => {
  200 |     await page.goto('/proveedores');
  201 |     await expect(page.getByRole('heading', { level: 1, name: 'Proveedores' })).toBeVisible({ timeout: 10000 });
  202 | 
  203 |     const editBtn = page.getByTestId('edit-supplier-btn').first();
  204 |     if (!(await editBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
  205 |       test.skip();
  206 |       return;
  207 |     }
  208 | 
  209 |     await editBtn.click({ force: true });
  210 |     await expect(page.getByTestId('supplier-name-input')).toBeVisible();
  211 | 
  212 |     const uniqueName = `Proveedor Editado E2E ${Date.now()}`;
  213 |     const nameInput = page.getByTestId('supplier-name-input');
  214 |     await nameInput.clear();
  215 |     await nameInput.fill(uniqueName);
  216 |     await page.getByTestId('submit-btn').click({ force: true });
  217 | 
  218 |     await expect(
  219 |       page.locator('[data-slot="table-container"]').getByText(uniqueName)
  220 |     ).toBeVisible({ timeout: 10000 });
  221 |   });
  222 | 
  223 |   test('can delete a supplier', async ({ page }) => {
  224 |     await page.goto('/proveedores');
  225 |     await expect(page.getByRole('heading', { level: 1, name: 'Proveedores' })).toBeVisible({ timeout: 10000 });
  226 | 
  227 |     const deleteBtn = page.getByTestId('delete-supplier-btn').first();
  228 |     if (!(await deleteBtn.isVisible({ timeout: 10000 }).catch(() => false))) {
  229 |       test.skip();
  230 |       return;
  231 |     }
  232 | 
  233 |     await deleteBtn.click({ force: true });
  234 |     await page.getByTestId('confirm-delete-btn').click({ force: true });
  235 | 
  236 |     await expect(
  237 |       page.locator('[data-slot="table-container"]')
  238 |     ).toBeVisible({ timeout: 10000 });
  239 |   });
  240 | });
  241 | 
```