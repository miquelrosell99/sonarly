import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '../../lib/cn.js';
import { Icon } from '../ui/Icon.js';
import {
  CHIP_BUTTON_CLASS,
  ChipMoveButtons,
  ChipRemoveButton,
  chipShellClass,
} from './chipBits.js';

export interface DndChipRowProps {
  values: string[];
  disabled?: boolean;
  onMove: (index: number, delta: -1 | 1) => void;
  onRemove: (index: number) => void;
  onDragReorder: (from: number, to: number) => void;
}

/**
 * Drag-and-drop chip row for SortablePillInput, kept in its own module so
 * @dnd-kit stays out of the edit chunk's static graph: SortablePillInput
 * dynamic-imports this file when the editor renders and degrades to plain
 * (button-reorderable) chips if the chunk has not arrived yet. Chips are
 * stateless, so the upgrade swap is invisible; the text input lives outside
 * this boundary and never remounts.
 */
export function DndChipRow({
  values,
  disabled,
  onMove,
  onRemove,
  onDragReorder,
}: DndChipRowProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = values.indexOf(String(active.id));
    const to = values.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onDragReorder(from, to);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={values} strategy={horizontalListSortingStrategy}>
        {values.map((value, index) => (
          <SortableChip
            key={value}
            value={value}
            index={index}
            total={values.length}
            disabled={disabled}
            onMove={(delta) => onMove(index, delta)}
            onRemove={() => onRemove(index)}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

function SortableChip({
  value,
  index,
  total,
  disabled,
  onMove,
  onRemove,
}: {
  value: string;
  index: number;
  total: number;
  disabled?: boolean;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: value,
    disabled,
  });

  return (
    <span
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={chipShellClass(!disabled, isDragging)}
    >
      {!disabled && (
        <button
          type="button"
          aria-label={`Reorder ${value}`}
          title={`Reorder ${value} — drag, or focus and press Enter then arrow keys`}
          className={cn(CHIP_BUTTON_CLASS, 'cursor-grab touch-none')}
          {...attributes}
          {...listeners}
        >
          <Icon name="mdi-drag-vertical" size={13} />
        </button>
      )}
      <span className="max-w-44 truncate">{value}</span>
      {!disabled && (
        <>
          <ChipMoveButtons value={value} index={index} total={total} onMove={onMove} />
          <ChipRemoveButton value={value} onRemove={onRemove} />
        </>
      )}
    </span>
  );
}
