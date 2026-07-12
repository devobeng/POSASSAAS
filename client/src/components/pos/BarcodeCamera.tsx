'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  onScan: (barcode: string) => void;
  onClose: () => void;
}

// Lazily load @zxing/browser only on client (it uses browser APIs)
export default function BarcodeCamera({ onScan, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const readerRef = useRef<unknown>(null);

  useEffect(() => {
    let stopped = false;

    const init = async () => {
      try {
        setScanning(true);
        // Dynamic import to avoid SSR issues
        const { BrowserMultiFormatReader, NotFoundException } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        readerRef.current = reader;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });

        if (!videoRef.current || stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        // Decode loop
        const decode = async () => {
          if (stopped || !videoRef.current) return;
          try {
            const result = await reader.decodeOnceFromVideoElement(videoRef.current);
            if (result && !stopped) {
              onScan(result.getText());
            }
          } catch (err) {
            if (err instanceof NotFoundException) {
              // No barcode in frame — retry
              if (!stopped) setTimeout(decode, 300);
            } else {
              setError('Camera decode error');
            }
          }
        };
        decode();
      } catch {
        setError('Camera access denied or unavailable');
        setScanning(false);
      }
    };

    init();

    return () => {
      stopped = true;
      // Stop camera stream
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
      }
    };
  }, [onScan]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <h2 className="font-semibold text-sm text-gray-900 dark:text-gray-100">Scan barcode</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            ✕
          </button>
        </div>

        <div className="relative aspect-square bg-black">
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center text-center px-6">
              <div>
                <p className="text-4xl mb-3">📷</p>
                <p className="text-sm text-gray-300">{error}</p>
              </div>
            </div>
          ) : (
            <>
              <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
              {/* Aim overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-48 h-48 border-2 border-primary-400 rounded-lg opacity-70" />
              </div>
              {scanning && (
                <div className="absolute top-3 left-0 right-0 flex justify-center">
                  <span className="text-xs text-white bg-black/50 px-2 py-1 rounded-full">
                    Point at barcode
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 text-center">
          Supports EAN-13, Code 128, QR Code, and more
        </div>
      </div>
    </div>
  );
}
