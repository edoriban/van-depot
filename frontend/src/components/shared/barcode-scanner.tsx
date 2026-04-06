'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Button } from '@/components/ui/button';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon } from '@hugeicons/core-free-icons';

interface BarcodeScannerProps {
  onScan: (code: string) => void;
  onClose: () => void;
}

export function BarcodeScanner({ onScan, onClose }: BarcodeScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScan = useCallback(
    (decodedText: string) => {
      scannerRef.current?.stop().catch(() => {});
      onScan(decodedText);
    },
    [onScan]
  );

  useEffect(() => {
    const scanner = new Html5Qrcode('barcode-reader');
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1,
        },
        (decodedText) => {
          handleScan(decodedText);
        },
        () => {
          // Ignore scan failures -- normal while user is aiming
        }
      )
      .catch(() => {
        setError('No se pudo acceder a la camara. Verifica los permisos.');
      });

    return () => {
      scanner.stop().catch(() => {});
    };
  }, [handleScan]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black flex flex-col"
      data-testid="barcode-scanner"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <span className="text-white text-lg font-medium">Escanear codigo</span>
        <button
          onClick={onClose}
          className="text-white p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
          data-testid="barcode-scanner-close"
        >
          <HugeiconsIcon icon={Cancel01Icon} className="h-6 w-6" />
        </button>
      </div>

      {/* Scanner viewport */}
      <div className="flex-1 flex items-center justify-center">
        <div id="barcode-reader" className="w-full max-w-sm" />
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 text-center">
          <p className="text-red-400 text-sm mb-3">{error}</p>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      )}

      {/* Help text */}
      <div className="p-4 text-center text-zinc-400 text-sm">
        Apunta la camara al codigo de barras o QR del producto
      </div>
    </div>
  );
}
