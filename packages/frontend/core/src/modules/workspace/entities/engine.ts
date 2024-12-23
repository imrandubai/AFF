import type { WorkerClient } from '@affine/nbstore/worker/client';
import { Entity } from '@toeverything/infra';

import { WorkspaceEngineBeforeStart } from '../events';
import type { WorkspaceFlavourProvider } from '../providers/flavour';
import type { WorkspaceEngineWorkerProvider } from '../providers/worker';
import type { WorkspaceService } from '../services/workspace';

export class WorkspaceEngine extends Entity<{
  workspaceFlavourProvider: WorkspaceFlavourProvider;
}> {
  worker?: WorkerClient;

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workerProvider: WorkspaceEngineWorkerProvider
  ) {
    super();
  }

  get doc() {
    if (!this.worker) {
      throw new Error('Engine is not initialized');
    }
    return this.worker.docFrontend;
  }

  get blob() {
    if (!this.worker) {
      throw new Error('Engine is not initialized');
    }
    return this.worker.blobFrontend;
  }

  get awareness() {
    if (!this.worker) {
      throw new Error('Engine is not initialized');
    }
    return this.worker.awarenessFrontend;
  }

  start() {
    this.eventBus.emit(WorkspaceEngineBeforeStart, this);

    const { client, dispose } = this.workerProvider.openWorker(
      this.props.workspaceFlavourProvider.getEngineWorkerInitOptions(
        this.workspaceService.workspace.id
      )
    );
    this.worker = client;
    this.disposables.push(dispose);

    const rootDoc = this.workspaceService.workspace.docCollection.doc;
    this.doc.addPriority(rootDoc.guid, 100);
    this.doc.addDoc(rootDoc, true);
    this.doc.start();
    this.disposables.push(() => this.doc.stop());
    this.awareness.connect(this.workspaceService.workspace.awareness);
  }

  get docState$() {
    return this.doc.state$;
  }

  rootDocState$ = this.doc.docState$(this.workspaceService.workspace.id);

  waitForDocSynced() {
    return this.doc.waitForSynced();
  }

  waitForRootDocReady() {
    return this.doc.waitForDocReady(this.workspaceService.workspace.id);
  }
}
