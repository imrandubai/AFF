import type { EditorHost } from '@blocksuite/affine/block-std';
import {
  type AffineAIPanelWidgetConfig,
  type AIItemGroupConfig,
  createLitPortal,
} from '@blocksuite/affine/blocks';
import { WithDisposable } from '@blocksuite/affine/global/utils';
import { flip, offset } from '@floating-ui/dom';
import { css, html, LitElement } from 'lit';
import { property } from 'lit/decorators.js';

import { getAIPanel } from '../../ai-panel';
import { AIProvider } from '../../provider';
import { extractContext } from '../../utils/extract';

export class AskAIToolbarButton extends WithDisposable(LitElement) {
  static override styles = css`
    .ask-ai-button {
      border-radius: 4px;
      position: relative;
      user-select: none;
    }
  `;

  private _abortController: AbortController | null = null;

  private _panelRoot: HTMLDivElement | null = null;

  @property({ attribute: false })
  accessor host!: EditorHost;

  @property({ attribute: false })
  accessor actionGroups!: AIItemGroupConfig[];

  private readonly _onItemClick = () => {
    const aiPanel = getAIPanel(this.host);
    aiPanel.restoreSelection();
    this._clearAbortController();
  };

  private readonly _clearAbortController = () => {
    this._abortController?.abort();
    this._abortController = null;
  };

  private readonly _openAIPanel = () => {
    this._clearAbortController();
    const aiPanel = getAIPanel(this.host);
    this._abortController = new AbortController();
    this._panelRoot = createLitPortal({
      template: html`
        <ask-ai-panel
          .host=${this.host}
          .actionGroups=${this.actionGroups}
          .onItemClick=${this._onItemClick}
        ></ask-ai-panel>
      `,
      computePosition: {
        referenceElement: aiPanel,
        placement: 'top-start',
        middleware: [flip(), offset({ mainAxis: 3 })],
        autoUpdate: true,
      },
      abortController: this._abortController,
      closeOnClickAway: true,
    });
  };

  private readonly _generateAnswer: AffineAIPanelWidgetConfig['generateAnswer'] =
    ({ finish, input }) => {
      finish('success');
      const aiPanel = getAIPanel(this.host);
      aiPanel.discard();
      AIProvider.slots.requestOpenWithChat.emit({ host: this.host });
      extractContext(this.host)
        .then(context => {
          AIProvider.slots.requestSendWithChat.emit({ input, context });
        })
        .catch(console.error);
    };

  private readonly _onClick = () => {
    const aiPanel = getAIPanel(this.host);
    if (!aiPanel.config) return;
    aiPanel.config.generateAnswer = this._generateAnswer;
    aiPanel.config.inputCallback = text => {
      if (!this._panelRoot) return;
      this._panelRoot.style.visibility = text ? 'hidden' : 'visible';
    };

    const textSelection = this.host.selection.find('text');
    const blockSelections = this.host.selection.filter('block');
    let lastBlockId: string | undefined;
    if (textSelection) {
      lastBlockId = textSelection.to?.blockId ?? textSelection.blockId;
    } else if (blockSelections.length) {
      lastBlockId = blockSelections[blockSelections.length - 1].blockId;
    }
    if (!lastBlockId) return;
    const block = this.host.view.getBlock(lastBlockId);
    if (!block) return;
    aiPanel.setState('input', block);

    setTimeout(() => this._openAIPanel(), 0);
  };

  override render() {
    return html`<div class="ask-ai-button" @click=${this._onClick}>
      <ask-ai-icon .size=${'middle'}></ask-ai-icon>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ask-ai-toolbar-button': AskAIToolbarButton;
  }
}
