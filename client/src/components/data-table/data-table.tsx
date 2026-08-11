import { useMemo, useRef, useState } from "react";
import {
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
  type RowData,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  useReactTable,
} from "@tanstack/react-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ArrowUpDown, ArrowUp, ArrowDown, Search, X, SlidersHorizontal, Columns3,
  Download, Upload, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Check,
} from "lucide-react";
import { toCsv, downloadCsv, parseCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";

// Per-column extras used for rendering + export.
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    label?: string;
    align?: "left" | "right" | "center";
    className?: string;
    exportValue?: (row: TData) => string | number | null | undefined;
    /** Renders a filter control under this column's header when the table has
     *  columnFilterRow enabled. "select" builds its options from the data. */
    filter?: "text" | "select";
    filterPlaceholder?: string;
  }
}

export interface FacetedFilter {
  columnId: string;
  title: string;
  options: { label: string; value: string }[];
}

interface DataTableProps<TData> {
  columns: ColumnDef<TData, any>[];
  data: TData[];
  searchPlaceholder?: string;
  /** Columns whose accessor value the global search should match against. */
  searchKeys?: (keyof TData)[];
  facetedFilters?: FacetedFilter[];
  onRowClick?: (row: TData) => void;
  exportFileName?: string;
  /** Enables the Import button; receives parsed CSV rows. */
  onImport?: (rows: Record<string, string>[]) => void | Promise<void>;
  /** Import button navigates instead of opening a file picker (dedicated
   *  import pages) — takes precedence over onImport. */
  onImportClick?: () => void;
  /** Extra controls rendered inline in the toolbar's right group (e.g. a
   *  date-range filter) so page filters align with Columns/Import/Export. */
  toolbarExtra?: React.ReactNode;
  initialPageSize?: number;
  emptyMessage?: string;
  /** Adds a leading "Sr. No." column. It numbers the CURRENT sorted+filtered
   *  view and continues across pages (page 2 starts at 11, not 1), so it reads
   *  like a printed register. It is a position, never an identity — use the
   *  record number column for that. */
  serialNumbers?: boolean;
  /** Per-column filter inputs under the headers. Columns opt in via
   *  meta.filter ("text" | "select"); anything else gets a blank cell. */
  columnFilterRow?: boolean;
}

const alignClass = { left: "text-left", right: "text-right", center: "text-center" } as const;

/** Page buttons around the current page, with ellipses — 1 … 4 [5] 6 … 20.
 *  Keeps the control a fixed width however many pages there are. */
export function pageNumbers(current: number, count: number): (number | "…")[] {
  if (count <= 1) return [];
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  const out: (number | "…")[] = [0];
  const start = Math.max(1, current - 1);
  const end = Math.min(count - 2, current + 1);
  if (start > 1) out.push("…");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < count - 2) out.push("…");
  out.push(count - 1);
  return out;
}

export function DataTable<TData>({
  columns,
  data,
  searchPlaceholder = "Search...",
  searchKeys,
  facetedFilters = [],
  onRowClick,
  exportFileName,
  onImport,
  onImportClick,
  toolbarExtra,
  initialPageSize = 10,
  emptyMessage = "No results.",
  serialNumbers = true,
  columnFilterRow = false,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const fileRef = useRef<HTMLInputElement>(null);

  // The serial column is prepended here rather than in every page's column
  // list. It is display-only: not sortable, not filterable, excluded from
  // export (the record number is the identity worth exporting).
  const tableColumns = useMemo<ColumnDef<TData, any>[]>(() => {
    if (!serialNumbers) return columns;
    const srCol: ColumnDef<TData, any> = {
      id: "__sr",
      header: "Sr.",
      enableSorting: false,
      enableHiding: false,
      enableGlobalFilter: false,
      size: 48,
      meta: { label: "Sr.", align: "center", className: "w-[52px] text-muted-foreground" },
      cell: ({ row, table: t }) => {
        // row.index is the row's position in the UNPAGINATED model, so adding
        // the page offset to it double-counts (page 2 started at 21, footer
        // said 11–20). Use the position within the current page instead.
        const { pageIndex, pageSize } = t.getState().pagination;
        const posInPage = t.getRowModel().rows.findIndex((r) => r.id === row.id);
        return (
          <span className="tabular-nums text-xs text-muted-foreground">
            {pageIndex * pageSize + (posInPage === -1 ? 0 : posInPage) + 1}
          </span>
        );
      },
    };
    return [srCol, ...columns];
  }, [columns, serialNumbers]);

  const table = useReactTable({
    data,
    columns: tableColumns,
    state: { sorting, columnFilters, globalFilter, columnVisibility },
    initialState: { pagination: { pageSize: initialPageSize } },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    globalFilterFn: (row, _colId, value) => {
      const q = String(value).toLowerCase().trim();
      if (!q) return true;
      const keys = searchKeys ?? (Object.keys(row.original as any) as (keyof TData)[]);
      return keys.some((k) => String((row.original as any)[k] ?? "").toLowerCase().includes(q));
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  const activeFilters = columnFilters.length + (globalFilter ? 1 : 0);
  const anyColumnFilterable = tableColumns.some((c) => (c as any).meta?.filter);

  function handleExport() {
    if (!exportFileName) return;
    const cols = table.getVisibleLeafColumns().filter((c) => c.id !== "actions" && c.id !== "__sr");
    const headers = cols.map((c) => c.columnDef.meta?.label ?? c.id);
    // Export the filtered + sorted rows (what the user currently sees, all pages).
    const rows = table.getSortedRowModel().rows.map((r) =>
      cols.map((c) => {
        const meta = c.columnDef.meta;
        if (meta?.exportValue) return meta.exportValue(r.original);
        const v = r.getValue(c.id);
        return v == null ? "" : (v as any);
      }),
    );
    downloadCsv(exportFileName, toCsv(headers, rows));
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !onImport) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(String(reader.result || ""));
      void onImport(rows);
    };
    reader.readAsText(file);
    e.target.value = ""; // allow re-importing the same file
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9 pr-8 h-9"
            data-testid="datatable-search"
          />
          {globalFilter && (
            <button onClick={() => setGlobalFilter("")} className="absolute right-3 top-1/2 -translate-y-1/2" aria-label="Clear search">
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>

        {facetedFilters.map((f) => (
          <FacetedFilterMenu key={f.columnId} table={table} filter={f} />
        ))}

        {activeFilters > 0 && (
          <Button variant="ghost" size="sm" className="h-9 px-2 text-muted-foreground" onClick={() => { setColumnFilters([]); setGlobalFilter(""); }}>
            Reset <X className="w-3.5 h-3.5 ml-1" />
          </Button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {toolbarExtra}
          {/* Column visibility */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <Columns3 className="w-4 h-4 mr-2" /> Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table.getAllLeafColumns().filter((c) => c.getCanHide() && c.id !== "actions").map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  className="capitalize"
                  checked={c.getIsVisible()}
                  onCheckedChange={(v) => c.toggleVisibility(!!v)}
                >
                  {c.columnDef.meta?.label ?? c.id}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {onImportClick ? (
            <Button variant="outline" size="sm" className="h-9" onClick={onImportClick} data-testid="datatable-import">
              <Upload className="w-4 h-4 mr-2" /> Import
            </Button>
          ) : onImport ? (
            <>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportFile} data-testid="datatable-import-input" />
              <Button variant="outline" size="sm" className="h-9" onClick={() => fileRef.current?.click()}>
                <Upload className="w-4 h-4 mr-2" /> Import
              </Button>
            </>
          ) : null}
          {exportFileName && (
            <Button variant="outline" size="sm" className="h-9" onClick={handleExport} data-testid="datatable-export">
              <Download className="w-4 h-4 mr-2" /> Export
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border/70 overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="bg-muted/40 hover:bg-muted/40">
                  {hg.headers.map((header) => {
                    const meta = header.column.columnDef.meta;
                    const sortable = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    return (
                      <TableHead key={header.id} className={cn("h-9 whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide", meta?.align && alignClass[meta.align], meta?.className)}>
                        {header.isPlaceholder ? null : sortable ? (
                          <button
                            className={cn("inline-flex items-center gap-1.5 hover:text-foreground transition-colors", meta?.align === "right" && "flex-row-reverse")}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {sorted === "asc" ? <ArrowUp className="w-3.5 h-3.5" /> : sorted === "desc" ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUpDown className="w-3.5 h-3.5 opacity-40" />}
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}

              {/* Per-column filter row — the dense register look. A column opts
                  in with meta.filter; everything else renders an empty cell so
                  the grid stays aligned. */}
              {columnFilterRow && anyColumnFilterable && (
                <TableRow className="bg-muted/20 hover:bg-muted/20 border-border/60">
                  {table.getVisibleLeafColumns().map((col) => {
                    const meta = col.columnDef.meta;
                    const kind = meta?.filter;
                    return (
                      <TableHead key={col.id} className="h-9 px-2 py-1 align-middle">
                        {kind === "text" && (
                          <Input
                            value={(col.getFilterValue() as string) ?? ""}
                            onChange={(e) => col.setFilterValue(e.target.value || undefined)}
                            placeholder={meta?.filterPlaceholder ?? "Filter…"}
                            aria-label={`Filter ${meta?.label ?? col.id}`}
                            data-testid={`column-filter-${col.id}`}
                            className="h-7 text-xs px-2 rounded-md bg-background/70"
                          />
                        )}
                        {kind === "select" && (
                          <select
                            value={(col.getFilterValue() as string) ?? ""}
                            onChange={(e) => col.setFilterValue(e.target.value || undefined)}
                            aria-label={`Filter ${meta?.label ?? col.id}`}
                            data-testid={`column-filter-${col.id}`}
                            className="h-7 w-full text-xs px-1.5 rounded-md border border-input bg-background/70 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <option value="">All</option>
                            {Array.from(col.getFacetedUniqueValues?.()?.keys() ?? [])
                              .filter((v) => v !== undefined && v !== null && String(v) !== "")
                              .sort()
                              .map((v) => (
                                <option key={String(v)} value={String(v)}>{String(v)}</option>
                              ))}
                          </select>
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              )}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className={cn("border-border/60", onRowClick && "cursor-pointer")}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    data-testid={`datatable-row`}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta;
                      return (
                        <TableCell key={cell.id} className={cn("py-2 text-[13px] whitespace-nowrap", meta?.align && alignClass[meta.align], meta?.className)}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-28 text-center text-muted-foreground">
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="text-muted-foreground tabular-nums">
          {(() => {
            const total = table.getFilteredRowModel().rows.length;
            if (!total) return "No rows";
            const { pageIndex, pageSize } = table.getState().pagination;
            const from = pageIndex * pageSize + 1;
            const to = Math.min(total, (pageIndex + 1) * pageSize);
            return `Showing ${from}–${to} of ${total}${activeFilters > 0 ? " (filtered)" : ""}`;
          })()}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground hidden sm:inline">Rows per page</span>
            <Select value={String(table.getState().pagination.pageSize)} onValueChange={(v) => table.setPageSize(Number(v))}>
              <SelectTrigger className="h-8 w-[70px]"><SelectValue /></SelectTrigger>
              <SelectContent>{[10, 20, 30, 50, 100].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" aria-label="First page" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}><ChevronsLeft className="w-4 h-4" /></Button>
            <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Previous page" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}><ChevronLeft className="w-4 h-4" /></Button>
            {pageNumbers(table.getState().pagination.pageIndex, table.getPageCount()).map((p, i) =>
              p === "…" ? (
                <span key={`gap-${i}`} className="px-1 text-muted-foreground select-none">…</span>
              ) : (
                <Button
                  key={p}
                  variant={p === table.getState().pagination.pageIndex ? "default" : "outline"}
                  size="icon"
                  className={cn("h-8 w-8 text-xs tabular-nums", p === table.getState().pagination.pageIndex && "gradient-btn text-white")}
                  aria-label={`Page ${p + 1}`}
                  aria-current={p === table.getState().pagination.pageIndex ? "page" : undefined}
                  onClick={() => table.setPageIndex(p)}
                  data-testid={`page-${p + 1}`}
                >
                  {p + 1}
                </Button>
              ),
            )}
            <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Next page" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}><ChevronRight className="w-4 h-4" /></Button>
            <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Last page" onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}><ChevronsRight className="w-4 h-4" /></Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FacetedFilterMenu<TData>({ table, filter }: { table: any; filter: FacetedFilter }) {
  const column = table.getColumn(filter.columnId);
  const selected = new Set((column?.getFilterValue() as string[]) ?? []);
  const facets = column?.getFacetedUniqueValues?.() as Map<string, number> | undefined;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 border-dashed">
          <SlidersHorizontal className="w-4 h-4 mr-2" />
          {filter.title}
          {selected.size > 0 && (
            <>
              <span className="mx-2 h-4 w-px bg-border" />
              <Badge variant="secondary" className="rounded px-1.5 font-normal">{selected.size}</Badge>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-1" align="start">
        {filter.options.map((opt) => {
          const isSel = selected.has(opt.value);
          const count = facets?.get(opt.value);
          return (
            <button
              key={opt.value}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent"
              onClick={() => {
                const next = new Set(selected);
                if (isSel) next.delete(opt.value); else next.add(opt.value);
                const arr = Array.from(next);
                column?.setFilterValue(arr.length ? arr : undefined);
              }}
            >
              <span className={cn("flex h-4 w-4 items-center justify-center rounded border", isSel ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40")}>
                {isSel && <Check className="w-3 h-3" />}
              </span>
              <span className="flex-1 text-left">{opt.label}</span>
              {count != null && <span className="text-xs text-muted-foreground">{count}</span>}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
