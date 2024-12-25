import { focusTextModel } from '@blocksuite/affine-components/rich-text';
import { toast } from '@blocksuite/affine-components/toast';
import {
  DEFAULT_NOTE_HEIGHT,
  DEFAULT_NOTE_WIDTH,
  type ImageBlockProps,
  NOTE_MIN_HEIGHT,
  type NoteBlockModel,
  NoteDisplayMode,
} from '@blocksuite/affine-model';
import { TelemetryProvider } from '@blocksuite/affine-shared/services';
import type { NoteChildrenFlavour } from '@blocksuite/affine-shared/types';
import {
  handleNativeRangeAtPoint,
  humanFileSize,
} from '@blocksuite/affine-shared/utils';
import type { BlockStdScope } from '@blocksuite/block-std';
import { GfxControllerIdentifier } from '@blocksuite/block-std/gfx';
import {
  type IPoint,
  type IVec,
  Point,
  serializeXYWH,
  Vec,
} from '@blocksuite/global/utils';

import { calcBoundByOrigin, readImageSize } from '../components/utils.js';
import { DEFAULT_NOTE_OFFSET_X, DEFAULT_NOTE_OFFSET_Y } from './consts.js';
import { addBlock } from './crud.js';

export async function addImages(
  std: BlockStdScope,
  files: File[],
  options: {
    point?: IVec;
    maxWidth?: number;
  }
): Promise<string[]> {
  const imageFiles = [...files].filter(file => file.type.startsWith('image/'));
  if (!imageFiles.length) return [];

  const imageService = std.getService('affine:image');
  const gfx = std.get(GfxControllerIdentifier);

  if (!imageService) {
    console.error('Image service not found');
    return [];
  }

  const maxFileSize = imageService.maxFileSize;
  const isSizeExceeded = imageFiles.some(file => file.size > maxFileSize);
  if (isSizeExceeded) {
    toast(
      std.host,
      `You can only upload files less than ${humanFileSize(
        maxFileSize,
        true,
        0
      )}`
    );
    return [];
  }

  const { point, maxWidth } = options;
  let { x, y } = gfx.viewport.center;
  if (point) [x, y] = gfx.viewport.toModelCoord(...point);

  const dropInfos: { point: Point; blockId: string }[] = [];
  const IMAGE_STACK_GAP = 32;
  const isMultipleFiles = imageFiles.length > 1;
  const inTopLeft = isMultipleFiles ? true : false;

  // create image cards without image data
  imageFiles.forEach((file, index) => {
    const point = new Point(
      x + index * IMAGE_STACK_GAP,
      y + index * IMAGE_STACK_GAP
    );
    const center = Vec.toVec(point);
    const bound = calcBoundByOrigin(center, inTopLeft);
    const blockId = std.doc.addBlock(
      'affine:image',
      {
        size: file.size,
        xywh: bound.serialize(),
        index: gfx.layer.generateIndex(),
      },
      gfx.surface
    );
    dropInfos.push({ point, blockId });
  });

  // upload image data and update the image model
  const uploadPromises = imageFiles.map(async (file, index) => {
    const { point, blockId } = dropInfos[index];

    const sourceId = await std.doc.blobSync.set(file);
    const imageSize = await readImageSize(file);

    const center = Vec.toVec(point);
    // If maxWidth is provided, limit the width of the image to maxWidth
    // Otherwise, use the original width
    const width = maxWidth
      ? Math.min(imageSize.width, maxWidth)
      : imageSize.width;
    const height = maxWidth
      ? (imageSize.height / imageSize.width) * width
      : imageSize.height;
    const bound = calcBoundByOrigin(center, inTopLeft, width, height);

    std.doc.withoutTransact(() => {
      gfx.updateElement(blockId, {
        sourceId,
        ...imageSize,
        width,
        height,
        xywh: bound.serialize(),
      } satisfies Partial<ImageBlockProps>);
    });
  });
  await Promise.all(uploadPromises);

  const blockIds = dropInfos.map(info => info.blockId);
  gfx.selection.set({
    elements: blockIds,
    editing: false,
  });
  if (isMultipleFiles) {
    std.command.exec('autoResizeElements');
  }
  return blockIds;
}

export function addNoteAtPoint(
  std: BlockStdScope,
  /**
   * The point is in browser coordinate
   */
  point: IPoint,
  options: {
    width?: number;
    height?: number;
    parentId?: string;
    noteIndex?: number;
    offsetX?: number;
    offsetY?: number;
    scale?: number;
  } = {}
) {
  const gfx = std.get(GfxControllerIdentifier);
  const {
    width = DEFAULT_NOTE_WIDTH,
    height = DEFAULT_NOTE_HEIGHT,
    offsetX = DEFAULT_NOTE_OFFSET_X,
    offsetY = DEFAULT_NOTE_OFFSET_Y,
    parentId = gfx.doc.root?.id,
    noteIndex,
    scale = 1,
  } = options;
  const [x, y] = gfx.viewport.toModelCoord(point.x, point.y);
  const blockId = addBlock(
    std,
    'affine:note',
    {
      xywh: serializeXYWH(
        x - offsetX * scale,
        y - offsetY * scale,
        width,
        height
      ),
      displayMode: NoteDisplayMode.EdgelessOnly,
    },
    parentId,
    noteIndex
  );

  gfx.std.getOptional(TelemetryProvider)?.track('CanvasElementAdded', {
    control: 'canvas:draw',
    page: 'whiteboard editor',
    module: 'toolbar',
    segment: 'toolbar',
    type: 'note',
  });

  return blockId;
}

type NoteOptions = {
  childFlavour: NoteChildrenFlavour;
  childType: string | null;
  collapse: boolean;
};

export function addNote(
  std: BlockStdScope,
  point: Point,
  options: NoteOptions,
  width = DEFAULT_NOTE_WIDTH,
  height = DEFAULT_NOTE_HEIGHT
) {
  const noteId = addNoteAtPoint(std, point, {
    width,
    height,
  });

  const gfx = std.get(GfxControllerIdentifier);
  const doc = std.doc;

  const blockId = doc.addBlock(
    options.childFlavour,
    { type: options.childType },
    noteId
  );
  if (options.collapse && height > NOTE_MIN_HEIGHT) {
    const note = doc.getBlockById(noteId) as NoteBlockModel;
    doc.updateBlock(note, () => {
      note.edgeless.collapse = true;
      note.edgeless.collapsedHeight = height;
    });
  }
  gfx.tool.setTool('default');

  // Wait for edgelessTool updated
  requestAnimationFrame(() => {
    const blocks =
      (doc.root?.children.filter(
        child => child.flavour === 'affine:note'
      ) as BlockSuite.EdgelessBlockModelType[]) ?? [];
    const element = blocks.find(b => b.id === noteId);
    if (element) {
      gfx.selection.set({
        elements: [element.id],
        editing: true,
      });

      // Waiting dom updated, `note mask` is removed
      if (blockId) {
        focusTextModel(gfx.std, blockId);
      } else {
        // Cannot reuse `handleNativeRangeClick` directly here,
        // since `retargetClick` will re-target to pervious editor
        handleNativeRangeAtPoint(point.x, point.y);
      }
    }
  });
}
