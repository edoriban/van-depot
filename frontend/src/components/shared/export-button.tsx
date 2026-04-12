'use client';

import { Button } from '@/components/ui/button';
import { HugeiconsIcon } from '@hugeicons/react';
import { FileDownloadIcon } from '@hugeicons/core-free-icons';

interface ExportButtonProps {
  onExport: () => void;
  disabled?: boolean;
  label?: string;
}

export function ExportButton({ onExport, disabled, label = 'Exportar' }: ExportButtonProps) {
  return (
    <Button variant="outline" size="sm" onClick={onExport} disabled={disabled}>
      <HugeiconsIcon icon={FileDownloadIcon} size={16} className="mr-2" />
      {label}
    </Button>
  );
}
