import { GripVertical } from 'lucide-react';
import React from 'react';
import { cn } from '../../lib/utils';

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
  return (
    <div
      className={cn(
        'flex h-full w-full',
        direction === 'horizontal' ? 'flex-row' : 'flex-col',
        className
      )}
    >
      {children}
    </div>
  );
};

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
  children,
  className,
}) => {
  return (
    <div
      className={cn('flex flex-1 min-w-0 min-h-0 overflow-hidden', className)}
      style={{ flexBasis: `${defaultSize}%` }}
    >
      {children}
    </div>
  );
};

interface ResizableHandleProps {
  withHandle?: boolean;
  className?: string;
}

export const ResizableHandle: React.FC<ResizableHandleProps> = ({
  withHandle = false,
  className: _className,
}) => {
  return (
    <div
      className={cn(
        'flex items-center justify-center bg-border/50 hover:bg-border transition-colors cursor-col-resize',
        withHandle ? 'w-2' : 'w-1'
      )}
    >
      {withHandle && (
        <GripVertical size={12} className="text-muted-foreground/50" />
      )}
    </div>
  );
};
