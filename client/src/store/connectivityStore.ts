import { create } from 'zustand';

export type ConnectivityStatus = 'online' | 'offline' | 'syncing';

interface ConnectivityState {
  status: ConnectivityStatus;
  pendingCount: number;
  failedCount: number;
  setStatus: (status: ConnectivityStatus) => void;
  setPendingCount: (n: number) => void;
  setFailedCount: (n: number) => void;
}

export const useConnectivityStore = create<ConnectivityState>((set) => ({
  status: 'online',
  pendingCount: 0,
  failedCount: 0,
  setStatus: (status) => set({ status }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setFailedCount: (failedCount) => set({ failedCount }),
}));
