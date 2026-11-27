import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getCellIndex } from '../grid/gridMath';
import { PlaceholderGrid } from './PlaceholderGrid';

describe('PlaceholderGrid', () => {
  it('renders 81 cells with no initial selection', () => {
    render(<PlaceholderGrid />);
    const cells = screen.getAllByRole('gridcell');
    expect(cells).toHaveLength(81);
    expect(cells.every((cell) => cell.getAttribute('aria-selected') === 'false')).toBe(true);
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
