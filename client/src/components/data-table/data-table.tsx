import { useRef, useState } from "react";
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
}

const alignClass = { left: "text-left", right: "text-right", center: "text-center" } as const;

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
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const table = useReactTable({
    data,
    columns,
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

  function handleExport() {
    if (!exportFileName) return;
    const cols = table.getVisibleLeafColumns().filter((c) => c.id !== "actions");
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
                      <TableHead key={header.id} className={cn("h-10 whitespace-nowrap text-xs font-semibold", meta?.align && alignClass[meta.align], meta?.className)}>
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
                        <TableCell key={cell.id} className={cn("py-2.5 text-sm whitespace-nowrap", meta?.align && alignClass[meta.align], meta?.className)}>
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
        <div className="text-muted-foreground">
          {table.getFilteredRowModel().rows.length} row{table.getFilteredRowModel().rows.length !== 1 ? "s" : ""}
          {activeFilters > 0 && " (filtered)"}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground hidden sm:inline">Rows per page</span>
            <Select value={String(table.getState().pagination.pageSize)} onValueChange={(v) => table.setPageSize(Number(v))}>
              <SelectTrigger className="h-8 w-[70px]"><SelectValue /></SelectTrigger>
              <SelectContent>{[10, 20, 30, 50, 100].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="text-muted-foreground whitespace-nowrap">
            Page {table.getState().pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" aria-label="First page" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}><ChevronsLeft className="w-4 h-4" /></Button>
            <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Previous page" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}><ChevronLeft className="w-4 h-4" /></Button>
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
