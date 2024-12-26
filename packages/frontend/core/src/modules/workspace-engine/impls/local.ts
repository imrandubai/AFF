import { DebugLogger } from '@affine/debug';
import type { BlobStorage, DocStorage } from '@affine/nbstore';
import { IndexedDBBlobStorage, IndexedDBDocStorage } from '@affine/nbstore/idb';
import type { WorkerInitOptions } from '@affine/nbstore/worker/client';
import { DocCollection } from '@blocksuite/affine/store';
import type { FrameworkProvider } from '@toeverything/infra';
import { LiveData, Service } from '@toeverything/infra';
import { isEqual } from 'lodash-es';
import { nanoid } from 'nanoid';
import { Observable } from 'rxjs';
import { encodeStateAsUpdate } from 'yjs';

import { DesktopApiService } from '../../desktop-api';
import {
  getAFFiNEWorkspaceSchema,
  type WorkspaceFlavourProvider,
  type WorkspaceFlavoursProvider,
  type WorkspaceMetadata,
  type WorkspaceProfileInfo,
} from '../../workspace';
import type { WorkspaceEngineStorageProvider } from '../providers/engine';
import { getWorkspaceProfileWorker } from './out-worker';

export const LOCAL_WORKSPACE_LOCAL_STORAGE_KEY = 'affine-local-workspace';
const LOCAL_WORKSPACE_CHANGED_BROADCAST_CHANNEL_KEY =
  'affine-local-workspace-changed';

const logger = new DebugLogger('local-workspace');

export function getLocalWorkspaceIds(): string[] {
  try {
    return JSON.parse(
      localStorage.getItem(LOCAL_WORKSPACE_LOCAL_STORAGE_KEY) ?? '[]'
    );
  } catch (e) {
    logger.error('Failed to get local workspace ids', e);
    return [];
  }
}

export function setLocalWorkspaceIds(
  idsOrUpdater: string[] | ((ids: string[]) => string[])
) {
  localStorage.setItem(
    LOCAL_WORKSPACE_LOCAL_STORAGE_KEY,
    JSON.stringify(
      typeof idsOrUpdater === 'function'
        ? idsOrUpdater(getLocalWorkspaceIds())
        : idsOrUpdater
    )
  );
}

class LocalWorkspaceFlavourProvider implements WorkspaceFlavourProvider {
  constructor(private readonly framework: FrameworkProvider) {}

  peerId = 'local';
  flavour = 'local';
  notifyChannel = new BroadcastChannel(
    LOCAL_WORKSPACE_CHANGED_BROADCAST_CHANNEL_KEY
  );

  async deleteWorkspace(id: string): Promise<void> {
    setLocalWorkspaceIds(ids => ids.filter(x => x !== id));

    if (BUILD_CONFIG.isElectron) {
      const electronApi = this.framework.get(DesktopApiService);
      await electronApi.handler.workspace.delete(id);
    }

    // notify all browser tabs, so they can update their workspace list
    this.notifyChannel.postMessage(id);
  }
  async createWorkspace(
    initial: (
      docCollection: DocCollection,
      blobStorage: BlobStorage,
      docStorage: DocStorage
    ) => Promise<void>
  ): Promise<WorkspaceMetadata> {
    const id = nanoid();

    // save the initial state to local storage, then sync to cloud
    const docStorage = new IndexedDBDocStorage({
      id: id,
      peer: this.peerId,
      type: 'workspace',
    });
    const blobStorage = new IndexedDBBlobStorage({
      id: id,
      peer: this.peerId,
      type: 'workspace',
    });

    const docCollection = new DocCollection({
      id: id,
      idGenerator: () => nanoid(),
      schema: getAFFiNEWorkspaceSchema(),
      blobSources: {
        main: {
          get: async key => {
            const record = await blobStorage.get(key);
            return record
              ? new Blob([record.data], { type: record.mime })
              : null;
          },
          delete: async () => {
            return;
          },
          list: async () => {
            return [];
          },
          set: async (id, blob) => {
            await blobStorage.set({
              key: id,
              data: new Uint8Array(await blob.arrayBuffer()),
              mime: blob.type,
            });
            return id;
          },
          name: 'blob',
          readonly: false,
        },
      },
    });

    try {
      // apply initial state
      await initial(docCollection, blobStorage, docStorage);

      // save workspace to local storage, should be vary fast
      await docStorage.pushDocUpdate({
        docId: id,
        bin: encodeStateAsUpdate(docCollection.doc),
      });
      for (const subdocs of docCollection.doc.getSubdocs()) {
        await docStorage.pushDocUpdate({
          docId: subdocs.guid,
          bin: encodeStateAsUpdate(subdocs),
        });
      }

      // save workspace id to local storage
      setLocalWorkspaceIds(ids => [...ids, id]);

      // notify all browser tabs, so they can update their workspace list
      this.notifyChannel.postMessage(id);
    } finally {
      docCollection.dispose();
    }

    return { id, flavour: 'local' };
  }
  workspaces$ = LiveData.from(
    new Observable<WorkspaceMetadata[]>(subscriber => {
      let last: WorkspaceMetadata[] | null = null;
      const emit = () => {
        const value = getLocalWorkspaceIds().map(id => ({
          id,
          flavour: 'local',
        }));
        if (isEqual(last, value)) return;
        subscriber.next(value);
        last = value;
      };

      emit();
      const channel = new BroadcastChannel(
        LOCAL_WORKSPACE_CHANGED_BROADCAST_CHANNEL_KEY
      );
      channel.addEventListener('message', emit);

      return () => {
        channel.removeEventListener('message', emit);
        channel.close();
      };
    }),
    []
  );
  isRevalidating$ = new LiveData(false);
  revalidate(): void {
    // notify livedata to re-scan workspaces
    this.notifyChannel.postMessage(null);
  }

  async getWorkspaceProfile(
    id: string
  ): Promise<WorkspaceProfileInfo | undefined> {
    const docStorage = new IndexedDBDocStorage({
      id: id,
      peer: this.peerId,
      type: 'workspace',
    });
    const localData = await docStorage.getDoc(id);

    if (!localData) {
      return {
        isOwner: true,
      };
    }

    const client = getWorkspaceProfileWorker();

    const result = await client.call(
      'renderWorkspaceProfile',
      [localData.bin].filter(Boolean) as Uint8Array[]
    );

    return {
      name: result.name,
      avatar: result.avatar,
      isOwner: true,
    };
  }

  async getWorkspaceBlob(id: string, blobKey: string): Promise<Blob | null> {
    const blob = await new IndexedDBBlobStorage({
      id: id,
      peer: this.peerId,
      type: 'workspace',
    }).get(blobKey);
    return blob ? new Blob([blob.data], { type: blob.mime }) : null;
  }

  getEngineWorkerInitOptions(workspaceId: string): WorkerInitOptions {
    return {
      local: [
        {
          name: 'IndexedDBDocStorage',
          opts: {
            peer: this.peerId,
            type: 'workspace',
            id: workspaceId,
          },
        },
        {
          name: 'IndexedDBBlobStorage',
          opts: {
            peer: this.peerId,
            type: 'workspace',
            id: workspaceId,
          },
        },
        {
          name: 'IndexedDBSyncStorage',
          opts: {
            peer: this.peerId,
            type: 'workspace',
            id: workspaceId,
          },
        },
        {
          name: 'BroadcastChannelAwarenessStorage',
          opts: {
            peer: this.peerId,
            type: 'workspace',
            id: workspaceId,
          },
        },
      ],
      remotes: [],
    };
  }
}

export class LocalWorkspaceFlavoursProvider
  extends Service
  implements WorkspaceFlavoursProvider
{
  constructor() {
    super();
  }

  workspaceFlavours$ = new LiveData<WorkspaceFlavourProvider[]>([
    new LocalWorkspaceFlavourProvider(this.framework),
  ]);
}
