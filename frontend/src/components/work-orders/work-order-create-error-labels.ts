/**
 * components/work-orders/work-order-create-error-labels.ts — Spanish friendly
 * copy for known backend error codes returned by the create-WO endpoint.
 *
 * See `frontend/src/CONVENTIONS.md` §7 (Migration boundary) and §7.1
 * (Migration pattern — written as part of SDD `frontend-migration`).
 *
 * Preserved VERBATIM from the original `ordenes-de-trabajo/page.tsx`
 * implementation — load-bearing for spec WO-INV-2 (known-error → friendly
 * toast). Extracted as a sibling module per design §R8 to keep
 * `work-order-create-dialog.tsx` under the 270-LOC ceiling.
 */
export const CREATE_ERROR_LABELS: Record<string, string> = {
  WORK_ORDER_FG_PRODUCT_NOT_MANUFACTURED:
    'El producto terminado seleccionado no esta marcado como manufacturable.',
  WORK_ORDER_WAREHOUSE_HAS_NO_WORK_CENTER:
    'El almacen seleccionado no tiene ningun centro de trabajo configurado.',
  WORK_ORDER_BOM_INCLUDES_TOOL_SPARE:
    'La receta contiene herramientas o refacciones — elimina esos items antes de crear la orden.',
  RECIPE_ITEM_REJECTS_TOOL_SPARE:
    'La receta contiene un producto herramienta/refaccion que no se puede consumir.',
  PRODUCT_MANUFACTURED_REQUIRES_RAW_MATERIAL:
    'El producto debe ser de clase Materia prima para ser manufacturable.',
};
