import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getCellIndex } from '../grid/gridMath';
import { PlaceholderGrid } from './PlaceholderGrid';

describe('PlaceholderGrid', () => {
  it('renders 81 borderless cells directly inside the flat grid with no initial selection', () => {
    render(<PlaceholderGrid />);
    const grid = screen.getByRole('grid');
    const directChildren = Array.from(grid.children);
    expect(directChildren).toHaveLength(81);

    const cells = screen.getAllByRole('gridcell');
    expect(cells).toHaveLength(81);
    for (const child of directChildren) {
      expect(child.tagName).toBe('BUTTON');
      expect(child).toHaveAttribute('role', 'gridcell');
      expect(child).toHaveClass('hs-cell');
      expect((child as HTMLElement).style.borderWidth).toBe('');
      expect(child.getAttribute('aria-selected')).toBe('false');
    }
  });

  it('renders 12 thin interior lines and 4 thick 3x3 divider lines without thin lines at 300 or 600', () => {
    render(<PlaceholderGrid />);
    const svg = screen.getByTestId('grid-lines-svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 900 900');
    expect(svg.querySelectorAll('rect')).toHaveLength(0);

    const thinLines = Array.from(svg.querySelectorAll('line[data-line-kind="cell"]'));
    const boxLines = Array.from(svg.querySelectorAll('line[data-line-kind="box"]'));

    expect(thinLines).toHaveLength(12);
    expect(boxLines).toHaveLength(4);

    const thinVertical = thinLines.filter(
      (line) => line.getAttribute('x1') === line.getAttribute('x2'),
    );
    const thinHorizontal = thinLines.filter(
      (line) => line.getAttribute('y1') === line.getAttribute('y2'),
    );
    expect(thinVertical.map((line) => Number(line.getAttribute('x1')))).toEqual([
      100, 200, 400, 500, 700, 800,
    ]);
    expect(thinHorizontal.map((line) => Number(line.getAttribute('y1')))).toEqual([
      100, 200, 400, 500, 700, 800,
    ]);

    const boxVertical = boxLines.filter(
      (line) => line.getAttribute('x1') === line.getAttribute('x2'),
    );
    const boxHorizontal = boxLines.filter(
      (line) => line.getAttribute('y1') === line.getAttribute('y2'),
    );
    expect(boxVertical.map((line) => Number(line.getAttribute('x1')))).toEqual([300, 600]);
    expect(boxHorizontal.map((line) => Number(line.getAttribute('y1')))).toEqual([300, 600]);

    // Ensure 3x3 box divider group is rendered after thin interior cell lines (drawn on top).
    const groups = Array.from(svg.querySelectorAll('g[data-line-group]'));
    expect(groups.map((g) => g.getAttribute('data-line-group'))).toEqual(['cell', 'box']);
  });

  it('highlights selected cell and its 20 row/column/box peers on click', () => {
    render(<PlaceholderGrid />);
    const cells = screen.getAllByRole('gridcell');
    const targetIndex = getCellIndex(1, 1);
    const target = cells[targetIndex];
    expect(target).toBeDefined();
    if (!target) {
      return;
    }

    fireEvent.click(target);

    expect(target).toHaveAttribute('aria-selected', 'true');
    expect(target).toHaveAttribute('data-highlight', 'selected');
    expect(screen.getByText(/Selected: Row 2, Column 2 \(Box 1\)/)).toBeInTheDocument();

    const peers = cells.filter((cell) => cell.getAttribute('data-highlight') === 'peer');
    expect(peers).toHaveLength(20);
    expect(cells[getCellIndex(1, 7)]).toHaveAttribute('data-highlight', 'peer');
    expect(cells[getCellIndex(7, 1)]).toHaveAttribute('data-highlight', 'peer');
    expect(cells[getCellIndex(2, 2)]).toHaveAttribute('data-highlight', 'peer');
    expect(cells[getCellIndex(8, 8)]).toHaveAttribute('data-highlight', 'none');
  });

  it('supports keyboard arrow navigation and Escape to clear selection', () => {
    render(<PlaceholderGrid />);
    const cells = screen.getAllByRole('gridcell');
    const startIndex = getCellIndex(0, 0);
    const startCell = cells[startIndex];
    expect(startCell).toBeDefined();
    if (!startCell) {
      return;
    }

    fireEvent.click(startCell);
    fireEvent.keyDown(startCell, { key: 'ArrowRight' });

    const rightCell = cells[getCellIndex(0, 1)];
    expect(rightCell).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(rightCell);

    if (rightCell) {
      fireEvent.keyDown(rightCell, { key: 'ArrowDown' });
    }
    const downCell = cells[getCellIndex(1, 1)];
    expect(downCell).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(downCell);

    if (downCell) {
      fireEvent.keyDown(downCell, { key: 'Escape' });
    }
    expect(downCell).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText(/Select any cell/)).toBeInTheDocument();
  });
});
