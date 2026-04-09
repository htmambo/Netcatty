import { GripVertical } from 'lucide-react';
import React, {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { cn } from '../../lib/utils';

// ---------- Context ----------

interface ResizableContextValue {
  groupId: string;
  direction: 'horizontal' | 'vertical';
}

const ResizableContext = createContext<ResizableContextValue | null>(null);

// ---------- Panel Group ----------

interface ResizablePanelGroupProps {
  direction: 'horizontal' | 'vertical';
  className?: string;
  children: React.ReactNode;
}

export const ResizablePanelGroup: React.FC<ResizablePanelGroupProps> = ({
  direction,
  className,
  children,
}) => {
  const groupId = useId();

  const contextValue: ResizableContextValue = {
    groupId,
    direction,
  };

  return (
    <ResizableContext.Provider value={contextValue}>
      <div
        data-resizable-group
        className={cn(
          'flex h-full w-full',
          direction === 'horizontal' ? 'flex-row' : 'flex-col',
          className,
        )}
      >
        {children}
      </div>
    </ResizableContext.Provider>
  );
};

// ---------- Panel ----------

interface ResizablePanelProps {
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  onSizeChange?: (size: number) => void;
  children: React.ReactNode;
  className?: string;
}

export const ResizablePanel: React.FC<ResizablePanelProps> = ({
  defaultSize = 50,
  minSize = 0,
  maxSize = 100,
  onSizeChange,
  children,
  className,
}) => {
  const context = useContext(ResizableContext);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelIndex, setPanelIndex] = useState<number>(0);

  useEffect(() => {
    if (!panelRef.current) return;
    const groupEl = panelRef.current.closest('[data-resizable-group]');
    if (!groupEl) return;
    const siblings = Array.from(groupEl.querySelectorAll('[data-panel-index]'));
    const idx = siblings.indexOf(panelRef.current);
    if (idx >= 0) setPanelIndex(idx);
  }, []);

  // Outside of a group — render as a simple flex child
  if (!context) {
    return (
      <div
        className={cn('flex flex-1 min-w-0 min-h-0 overflow-hidden', className)}
        style={{ flexBasis: `${defaultSize}%` }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      data-panel-index={panelIndex}
      data-panel-default-size={defaultSize}
      data-panel-min-size={minSize}
      data-panel-max-size={maxSize}
      className={cn('flex min-w-0 min-h-0 overflow-hidden', className)}
      style={{ flexBasis: `${defaultSize}%` }}
    >
      {children}
    </div>
  );
};

// ---------- Handle ----------

interface ResizableHandleProps {
  withHandle?: boolean;
  className?: string;
}

export const ResizableHandle: React.FC<ResizableHandleProps> = ({
  withHandle = false,
  className: _className,
}) => {
  const context = useContext(ResizableContext);
  const handleRef = useRef<HTMLDivElement>(null);
  const [handleIndex, setHandleIndex] = useState<number>(0);
  const [isDragging, setIsDragging] = useState(false);

  // Determine handle index by finding its position among group children
  useEffect(() => {
    if (!handleRef.current) return;
    const groupEl = handleRef.current.closest('[data-resizable-group]');
    if (!groupEl) return;
    const children = Array.from(groupEl.children);
    const idx = children.indexOf(handleRef.current);
    // Handle index = number of [data-panel-index] elements before it
    const panelsBefore = children.filter((el, i) => i < idx && el.hasAttribute('data-panel-index')).length;
    setHandleIndex(panelsBefore);
  }, []);

  if (!context) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-border/50 hover:bg-border transition-colors cursor-col-resize',
          withHandle ? 'w-2' : 'w-1',
        )}
      >
        {withHandle && (
          <GripVertical size={12} className="text-muted-foreground/50" />
        )}
      </div>
    );
  }

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const groupEl = handleRef.current?.closest('[data-resizable-group]') as HTMLElement | null;
    if (!groupEl) return;

    const panels = Array.from(groupEl.querySelectorAll<HTMLElement>('[data-panel-index]'));
    if (panels.length < handleIndex + 2) return;

    const panelEl = panels[handleIndex];
    const nextPanelEl = panels[handleIndex + 1];
    if (!panelEl || !nextPanelEl) return;

    const minSize = parseFloat(panelEl.dataset.panelMinSize || '0');
    const maxSize = parseFloat(panelEl.dataset.panelMaxSize || '100');
    const nextMinSize = parseFloat(nextPanelEl.dataset.panelMinSize || '0');
    const nextMaxSize = parseFloat(nextPanelEl.dataset.panelMaxSize || '100');

    // Read current flex-basis percentages
    const containerSize =
      context.direction === 'horizontal' ? groupEl.clientWidth : groupEl.clientHeight;
    if (containerSize === 0) return;

    const currentBasis = parseFloat(panelEl.style.flexBasis) || 50;
    const nextBasis = parseFloat(nextPanelEl.style.flexBasis) || 50;

    const startX = e.clientX;
    const startY = e.clientY;

    const onMouseMove = (ev: MouseEvent) => {
      ev.preventDefault();

      const isHorizontal = context.direction === 'horizontal';
      const delta = isHorizontal
        ? ev.clientX - startX
        : ev.clientY - startY;
      const deltaPercent = (delta / containerSize) * 100;

      let newSize = currentBasis + deltaPercent;
      newSize = Math.max(minSize, Math.min(maxSize, newSize));

      // Constrain the next panel
      let newNextSize = nextBasis - (newSize - currentBasis);
      newNextSize = Math.max(nextMinSize, Math.min(nextMaxSize, newNextSize));

      // Recalculate left panel based on what right can actually give
      newSize = currentBasis + (nextBasis - newNextSize);
      newSize = Math.max(minSize, Math.min(maxSize, newSize));
      newNextSize = nextBasis - (newSize - currentBasis);

      panelEl.style.flexBasis = `${newSize}%`;
      panelEl.style.flexGrow = '0';
      panelEl.style.flexShrink = '0';
      nextPanelEl.style.flexBasis = `${newNextSize}%`;
      nextPanelEl.style.flexGrow = '0';
      nextPanelEl.style.flexShrink = '0';
    };

    const onMouseUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    setIsDragging(true);
    const isHorizontal = context.direction === 'horizontal';
    document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove, { passive: false });
    document.addEventListener('mouseup', onMouseUp);
  };

  const cursorType = context.direction === 'horizontal' ? 'cursor-col-resize' : 'cursor-row-resize';

  return (
    <div
      ref={handleRef}
      className={cn(
        'flex shrink-0 items-center justify-center bg-border/50 hover:bg-border transition-colors select-none',
        withHandle ? 'w-2' : 'w-1',
        cursorType,
        isDragging && 'bg-border',
      )}
      onMouseDown={onMouseDown}
    >
      {withHandle && (
        <GripVertical size={12} className="text-muted-foreground/50" />
      )}
    </div>
  );
};
