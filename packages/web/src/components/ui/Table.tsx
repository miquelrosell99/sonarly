import { Fragment, type ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  renderRow?: (row: T, element: ReactNode) => ReactNode;
}

export function Table<T>({ columns, rows, rowKey, empty, renderRow }: TableProps<T>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-rule text-muted">
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={cn('py-2 pr-4 font-medium', col.className)}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {rows.map((row) => {
            const tr = (
              <tr key={rowKey(row)}>
                {columns.map((col) => (
                  <td key={col.key} className={cn('py-2 pr-4', col.className)}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            );
            return renderRow ? (
              <Fragment key={rowKey(row)}>{renderRow(row, tr)}</Fragment>
            ) : (
              tr
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && empty !== undefined && (
        <div className="py-8 text-center text-sm text-muted">{empty}</div>
      )}
    </div>
  );
}
