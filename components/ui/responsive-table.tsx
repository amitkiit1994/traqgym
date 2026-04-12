export function ResponsiveTable({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">{children}</div>;
}
