import { cn } from './cn';

export function Table({ className, ...props }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  );
}

export function Thead(props) {
  return <thead className="bg-bg-alt" {...props} />;
}

export function Tbody(props) {
  return <tbody {...props} />;
}

export function Tr({ className, ...props }) {
  return <tr className={cn('border-t border-border', className)} {...props} />;
}

export function Th({ className, ...props }) {
  return <th className={cn('px-3 py-2 text-left font-semibold text-text-h', className)} {...props} />;
}

export function Td({ className, ...props }) {
  return <td className={cn('px-3 py-2 text-text', className)} {...props} />;
}
