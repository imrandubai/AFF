import {
  deleteBlobMutation,
  listBlobsQuery,
  releaseDeletedBlobsMutation,
  setBlobMutation,
} from '@affine/graphql';

import {
  type BlobRecord,
  BlobStorageBase,
  type BlobStorageOptions,
} from '../../storage';
import { HttpConnection } from './http';

interface CloudBlobStorageOptions extends BlobStorageOptions {
  serverBaseUrl: string;
}

export class CloudBlobStorage extends BlobStorageBase<CloudBlobStorageOptions> {
  static readonly identifier = 'CloudBlobStorage';

  readonly connection = new HttpConnection(this.options.serverBaseUrl);

  override async get(key: string) {
    const res = await this.connection.fetch(
      '/api/workspaces/' + this.spaceId + '/blobs/' + key,
      {
        cache: 'default',
        headers: {
          'x-affine-version': BUILD_CONFIG.appVersion,
        },
      }
    );

    if (res.status === 404) {
      return null;
    }

    try {
      const blob = await res.blob();

      return {
        key,
        data: new Uint8Array(await blob.arrayBuffer()),
        mime: blob.type,
        size: blob.size,
        createdAt: new Date(res.headers.get('last-modified') || Date.now()),
      };
    } catch (err) {
      throw new Error('blob download error: ' + err);
    }
  }

  override async set(blob: BlobRecord) {
    await this.connection.gql({
      query: setBlobMutation,
      variables: {
        workspaceId: this.spaceId,
        blob: new File([blob.data], blob.key, { type: blob.mime }),
      },
    });
  }

  override async delete(key: string, permanently: boolean) {
    await this.connection.gql({
      query: deleteBlobMutation,
      variables: { workspaceId: this.spaceId, key, permanently },
    });
  }

  override async release() {
    await this.connection.gql({
      query: releaseDeletedBlobsMutation,
      variables: { workspaceId: this.spaceId },
    });
  }

  override async list() {
    const res = await this.connection.gql({
      query: listBlobsQuery,
      variables: { workspaceId: this.spaceId },
    });

    return res.workspace.blobs.map(blob => ({
      ...blob,
      createdAt: new Date(blob.createdAt),
    }));
  }
}
