import type { Storage } from '../storage';
import { BroadcastChannelAwarenessStorage } from './broadcast-channel/awareness';
import {
  CloudAwarenessStorage,
  CloudBlobStorage,
  CloudDocStorage,
} from './cloud';
import {
  IndexedDBBlobStorage,
  IndexedDBDocStorage,
  IndexedDBSyncStorage,
} from './idb';
import { IndexedDBV1BlobStorage, IndexedDBV1DocStorage } from './idb/v1';

type StorageConstructor = {
  new (...args: any[]): Storage;
  identifier: string;
};

const idb = [
  IndexedDBDocStorage,
  IndexedDBBlobStorage,
  IndexedDBSyncStorage,
  BroadcastChannelAwarenessStorage,
] satisfies StorageConstructor[];

const idbv1 = [
  IndexedDBV1DocStorage,
  IndexedDBV1BlobStorage,
] satisfies StorageConstructor[];

const cloud = [
  CloudDocStorage,
  CloudBlobStorage,
  CloudAwarenessStorage,
] satisfies StorageConstructor[];

const storages = [...cloud, ...idbv1, ...idb] satisfies StorageConstructor[];

const AvailableStorageImplementations = storages.reduce((acc, curr) => {
  acc[curr.name] = curr;
  return acc;
}, {} as any) as {
  [key in (typeof storages)[number]['identifier']]: (typeof storages)[number] & {
    identifier: key;
  };
};

export type AvailableStorageImplementations =
  typeof AvailableStorageImplementations;

export const getAvailableStorageImplementations = <
  T extends keyof AvailableStorageImplementations,
>(
  name: T
): AvailableStorageImplementations[T] => {
  return AvailableStorageImplementations[name];
};
