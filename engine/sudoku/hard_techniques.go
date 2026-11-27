package sudoku

import (
	"math/bits"
	"slices"
)

func sortedUniqueInts(vals ...int) []int {
	out := make([]int, 0, len(vals))
	for _, v := range vals {
		if !slices.Contains(out, v) {
			out = append(out, v)
		}
	}
	slices.Sort(out)
	return out
}

func sortEliminations(elims []Elimination) {
	slices.SortFunc(elims, func(a, b Elimination) int {
		if a.Cell != b.Cell {
			return a.Cell - b.Cell
		}
		return int(a.Digit) - int(b.Digit)
	})
}

func lineCandidatePositions(b *Board, line [GridSize]int, d uint8) (uint16, [GridSize]int, int) {
	dMask := DigitMask(d)
	var posMask uint16
	var cells [GridSize]int
	n := 0
	for pos, cellIdx := range line {
		if b.Cells[cellIdx].Value == 0 && (b.Cells[cellIdx].Candidates&dMask) != 0 {
			posMask |= uint16(1) << pos
			cells[n] = cellIdx
			n++
		}
	}
	return posMask, cells, n
}

func findSkyscraper(b *Board) (Step, bool) {
	for d := uint8(1); d <= GridSize; d++ {
		dMask := DigitMask(d)

		// Row-based Skyscraper.
		var rowMasks [GridSize]uint16
		var rowCols [GridSize][2]int
		for r := range GridSize {
			mask, _, cnt := lineCandidatePositions(b, Rows[r], d)
			if cnt == 2 {
				rowMasks[r] = mask
				c1 := bits.TrailingZeros16(mask)
				c2 := bits.TrailingZeros16(mask &^ (uint16(1) << c1))
				rowCols[r] = [2]int{c1, c2}
			}
		}

		for r1 := range GridSize {
			if rowMasks[r1] == 0 {
				continue
			}
			for r2 := r1 + 1; r2 < GridSize; r2++ {
				if rowMasks[r2] == 0 {
					continue
				}
				shared := rowMasks[r1] & rowMasks[r2]
				if bits.OnesCount16(shared) != 1 {
					continue
				}
				baseCol := bits.TrailingZeros16(shared)
				roofCol1 := rowCols[r1][0]
				if roofCol1 == baseCol {
					roofCol1 = rowCols[r1][1]
				}
				roofCol2 := rowCols[r2][0]
				if roofCol2 == baseCol {
					roofCol2 = rowCols[r2][1]
				}
				base1 := Rows[r1][baseCol]
				base2 := Rows[r2][baseCol]
				roof1 := Rows[r1][roofCol1]
				roof2 := Rows[r2][roofCol2]

				var elims []Elimination
				for idx := range BoardSize {
					if idx == base1 || idx == base2 || idx == roof1 || idx == roof2 {
						continue
					}
					if b.Cells[idx].Value == 0 && (b.Cells[idx].Candidates&dMask) != 0 &&
						ArePeers(idx, roof1) && ArePeers(idx, roof2) {
						elims = append(elims, Elimination{Cell: idx, Digit: d})
					}
				}
				if len(elims) > 0 {
					sortEliminations(elims)
					return Step{
						Technique:    TechniqueSkyscraper,
						Difficulty:   DifficultyHard,
						Region:       Region{Kind: RegionRow, Index: r1},
						DrivingCells: sortedUniqueInts(base1, base2, roof1, roof2),
						Placements:   []Placement{},
						Eliminations: elims,
					}, true
				}
			}
		}

		// Column-based Skyscraper.
		var colMasks [GridSize]uint16
		var colRows [GridSize][2]int
		for c := range GridSize {
			mask, _, cnt := lineCandidatePositions(b, Cols[c], d)
			if cnt == 2 {
				colMasks[c] = mask
				r1 := bits.TrailingZeros16(mask)
				r2 := bits.TrailingZeros16(mask &^ (uint16(1) << r1))
				colRows[c] = [2]int{r1, r2}
			}
		}

		for c1 := range GridSize {
			if colMasks[c1] == 0 {
				continue
			}
			for c2 := c1 + 1; c2 < GridSize; c2++ {
				if colMasks[c2] == 0 {
					continue
				}
				shared := colMasks[c1] & colMasks[c2]
				if bits.OnesCount16(shared) != 1 {
					continue
				}
				baseRow := bits.TrailingZeros16(shared)
				roofRow1 := colRows[c1][0]
				if roofRow1 == baseRow {
					roofRow1 = colRows[c1][1]
				}
				roofRow2 := colRows[c2][0]
				if roofRow2 == baseRow {
					roofRow2 = colRows[c2][1]
				}
				base1 := Cols[c1][baseRow]
				base2 := Cols[c2][baseRow]
				roof1 := Cols[c1][roofRow1]
				roof2 := Cols[c2][roofRow2]

				var elims []Elimination
				for idx := range BoardSize {
					if idx == base1 || idx == base2 || idx == roof1 || idx == roof2 {
						continue
					}
					if b.Cells[idx].Value == 0 && (b.Cells[idx].Candidates&dMask) != 0 &&
						ArePeers(idx, roof1) && ArePeers(idx, roof2) {
						elims = append(elims, Elimination{Cell: idx, Digit: d})
					}
				}
				if len(elims) > 0 {
					sortEliminations(elims)
					return Step{
						Technique:    TechniqueSkyscraper,
						Difficulty:   DifficultyHard,
						Region:       Region{Kind: RegionColumn, Index: c1},
						DrivingCells: sortedUniqueInts(base1, base2, roof1, roof2),
						Placements:   []Placement{},
						Eliminations: elims,
					}, true
				}
			}
		}
	}
	return Step{}, false
}

func findXWing(b *Board) (Step, bool) {
	for d := uint8(1); d <= GridSize; d++ {
		dMask := DigitMask(d)

		// Row-based X-Wing.
		var rowMasks [GridSize]uint16
		for r := range GridSize {
			mask, _, cnt := lineCandidatePositions(b, Rows[r], d)
			if cnt == 2 {
				rowMasks[r] = mask
			}
		}
		for r1 := range GridSize {
			if rowMasks[r1] == 0 {
				continue
			}
			for r2 := r1 + 1; r2 < GridSize; r2++ {
				if rowMasks[r2] != rowMasks[r1] {
					continue
				}
				c1 := bits.TrailingZeros16(rowMasks[r1])
				c2 := bits.TrailingZeros16(rowMasks[r1] &^ (uint16(1) << c1))

				var elims []Elimination
				for r := range GridSize {
					if r == r1 || r == r2 {
						continue
					}
					for _, c := range []int{c1, c2} {
						cellIdx := Rows[r][c]
						if b.Cells[cellIdx].Value == 0 && (b.Cells[cellIdx].Candidates&dMask) != 0 {
							elims = append(elims, Elimination{Cell: cellIdx, Digit: d})
						}
					}
				}
				if len(elims) > 0 {
					sortEliminations(elims)
					return Step{
						Technique:    TechniqueXWing,
						Difficulty:   DifficultyHard,
						Region:       Region{Kind: RegionRow, Index: r1},
						DrivingCells: sortedUniqueInts(Rows[r1][c1], Rows[r1][c2], Rows[r2][c1], Rows[r2][c2]),
						Placements:   []Placement{},
						Eliminations: elims,
					}, true
				}
			}
		}

		// Column-based X-Wing.
		var colMasks [GridSize]uint16
		for c := range GridSize {
			mask, _, cnt := lineCandidatePositions(b, Cols[c], d)
			if cnt == 2 {
				colMasks[c] = mask
			}
		}
		for c1 := range GridSize {
			if colMasks[c1] == 0 {
				continue
			}
			for c2 := c1 + 1; c2 < GridSize; c2++ {
				if colMasks[c2] != colMasks[c1] {
					continue
				}
				r1 := bits.TrailingZeros16(colMasks[c1])
				r2 := bits.TrailingZeros16(colMasks[c1] &^ (uint16(1) << r1))

				var elims []Elimination
				for c := range GridSize {
					if c == c1 || c == c2 {
						continue
					}
					for _, r := range []int{r1, r2} {
						cellIdx := Cols[c][r]
						if b.Cells[cellIdx].Value == 0 && (b.Cells[cellIdx].Candidates&dMask) != 0 {
							elims = append(elims, Elimination{Cell: cellIdx, Digit: d})
						}
					}
				}
				if len(elims) > 0 {
					sortEliminations(elims)
					return Step{
						Technique:    TechniqueXWing,
						Difficulty:   DifficultyHard,
						Region:       Region{Kind: RegionColumn, Index: c1},
						DrivingCells: sortedUniqueInts(Cols[c1][r1], Cols[c1][r2], Cols[c2][r1], Cols[c2][r2]),
						Placements:   []Placement{},
						Eliminations: elims,
					}, true
				}
			}
		}
	}
	return Step{}, false
}

func collectBivalueCells(b *Board) []int {
	bivalues := make([]int, 0, BoardSize)
	for i := range BoardSize {
		if b.Cells[i].Value == 0 && CandidateCount(b.Cells[i].Candidates) == 2 {
			bivalues = append(bivalues, i)
		}
	}
	return bivalues
}

func findWWing(b *Board) (Step, bool) {
	bivalues := collectBivalueCells(b)
	if len(bivalues) < 2 {
		return Step{}, false
	}

	type strongLink struct {
		unitIdx int
		c1      int
		c2      int
	}
	var linksByDigit [GridSize + 1][]strongLink
	for unitIdx := range UnitCount {
		unit := Units[unitIdx]
		var posMask [GridSize + 1]uint16
		for pos, cellIdx := range unit {
			if b.Cells[cellIdx].Value != 0 {
				continue
			}
			for _, d := range CandidateDigits(b.Cells[cellIdx].Candidates) {
				posMask[d] |= uint16(1) << pos
			}
		}
		for d := uint8(1); d <= GridSize; d++ {
			if bits.OnesCount16(posMask[d]) == 2 {
				p1 := bits.TrailingZeros16(posMask[d])
				p2 := bits.TrailingZeros16(posMask[d] &^ (uint16(1) << p1))
				linksByDigit[d] = append(linksByDigit[d], strongLink{
					unitIdx: unitIdx,
					c1:      unit[p1],
					c2:      unit[p2],
				})
			}
		}
	}

	for i := range len(bivalues) {
		a := bivalues[i]
		mask := b.Cells[a].Candidates & AllCandidates
		digits := CandidateDigits(mask)
		x, y := digits[0], digits[1]

		for j := i + 1; j < len(bivalues); j++ {
			c := bivalues[j]
			if ArePeers(a, c) || (b.Cells[c].Candidates&AllCandidates) != mask {
				continue
			}

			for _, pair := range [2][2]uint8{{x, y}, {y, x}} {
				linkDigit, elimDigit := pair[0], pair[1]
				elimMask := DigitMask(elimDigit)

				var elims []Elimination
				for idx := range BoardSize {
					if idx == a || idx == c {
						continue
					}
					if b.Cells[idx].Value == 0 && (b.Cells[idx].Candidates&elimMask) != 0 &&
						ArePeers(idx, a) && ArePeers(idx, c) {
						elims = append(elims, Elimination{Cell: idx, Digit: elimDigit})
					}
				}
				if len(elims) == 0 {
					continue
				}

				for _, link := range linksByDigit[linkDigit] {
					if link.c1 == a || link.c1 == c || link.c2 == a || link.c2 == c {
						continue
					}
					linked := (ArePeers(a, link.c1) && ArePeers(c, link.c2)) ||
						(ArePeers(a, link.c2) && ArePeers(c, link.c1))
					if !linked {
						continue
					}

					sortEliminations(elims)
					return Step{
						Technique:    TechniqueWWing,
						Difficulty:   DifficultyHard,
						Region:       unitRegion(link.unitIdx),
						DrivingCells: sortedUniqueInts(a, c, link.c1, link.c2),
						Placements:   []Placement{},
						Eliminations: elims,
					}, true
				}
			}
		}
	}
	return Step{}, false
}

func findXYWing(b *Board) (Step, bool) {
	bivalues := collectBivalueCells(b)
	if len(bivalues) < 3 {
		return Step{}, false
	}

	for _, pivot := range bivalues {
		pivotMask := b.Cells[pivot].Candidates & AllCandidates
		var peerBivalues []int
		for _, candidate := range bivalues {
			if candidate != pivot && ArePeers(pivot, candidate) {
				peerBivalues = append(peerBivalues, candidate)
			}
		}
		if len(peerBivalues) < 2 {
			continue
		}

		for i := range len(peerBivalues) {
			p1 := peerBivalues[i]
			m1 := b.Cells[p1].Candidates & AllCandidates
			if m1 == pivotMask || CandidateCount(m1&pivotMask) != 1 {
				continue
			}
			for j := i + 1; j < len(peerBivalues); j++ {
				p2 := peerBivalues[j]
				m2 := b.Cells[p2].Candidates & AllCandidates
				if m2 == pivotMask || m2 == m1 || CandidateCount(m2&pivotMask) != 1 {
					continue
				}
				if (m1 & m2 & pivotMask) != 0 {
					continue
				}
				zMask := m1 & m2
				if CandidateCount(zMask) != 1 {
					continue
				}
				z := FirstCandidate(zMask)

				var elims []Elimination
				for idx := range BoardSize {
					if idx == pivot || idx == p1 || idx == p2 {
						continue
					}
					if b.Cells[idx].Value == 0 && (b.Cells[idx].Candidates&zMask) != 0 &&
						ArePeers(idx, p1) && ArePeers(idx, p2) {
						elims = append(elims, Elimination{Cell: idx, Digit: z})
					}
				}
				if len(elims) > 0 {
					sortEliminations(elims)
					return Step{
						Technique:    TechniqueXYWing,
						Difficulty:   DifficultyHard,
						Region:       Region{Kind: RegionCell, Index: pivot},
						DrivingCells: sortedUniqueInts(pivot, p1, p2),
						Placements:   []Placement{},
						Eliminations: elims,
					}, true
				}
			}
		}
	}
	return Step{}, false
}

func findSwordfish(b *Board) (Step, bool) {
	for d := uint8(1); d <= GridSize; d++ {
		dMask := DigitMask(d)

		// Row-based Swordfish.
		var rowMasks [GridSize]uint16
		var candRows []int
		for r := range GridSize {
			mask, _, cnt := lineCandidatePositions(b, Rows[r], d)
			if cnt == 2 || cnt == 3 {
				rowMasks[r] = mask
				candRows = append(candRows, r)
			}
		}
		for i := range len(candRows) {
			r1 := candRows[i]
			for j := i + 1; j < len(candRows); j++ {
				r2 := candRows[j]
				u12 := rowMasks[r1] | rowMasks[r2]
				if bits.OnesCount16(u12) > 3 {
					continue
				}
				for k := j + 1; k < len(candRows); k++ {
					r3 := candRows[k]
					colUnion := u12 | rowMasks[r3]
					if bits.OnesCount16(colUnion) != 3 {
						continue
					}

					var elims []Elimination
					for r := range GridSize {
						if r == r1 || r == r2 || r == r3 {
							continue
						}
						tmp := colUnion
						for tmp != 0 {
							lsb := tmp & -tmp
							tmp &^= lsb
							c := bits.TrailingZeros16(lsb)
							cellIdx := Rows[r][c]
							if b.Cells[cellIdx].Value == 0 && (b.Cells[cellIdx].Candidates&dMask) != 0 {
								elims = append(elims, Elimination{Cell: cellIdx, Digit: d})
							}
						}
					}
					if len(elims) > 0 {
						sortEliminations(elims)
						var driving []int
						for _, r := range []int{r1, r2, r3} {
							tmp := rowMasks[r]
							for tmp != 0 {
								lsb := tmp & -tmp
								tmp &^= lsb
								c := bits.TrailingZeros16(lsb)
								driving = append(driving, Rows[r][c])
							}
						}
						return Step{
							Technique:    TechniqueSwordfish,
							Difficulty:   DifficultyHard,
							Region:       Region{Kind: RegionRow, Index: r1},
							DrivingCells: sortedUniqueInts(driving...),
							Placements:   []Placement{},
							Eliminations: elims,
						}, true
					}
				}
			}
		}

		// Column-based Swordfish.
		var colMasks [GridSize]uint16
		var candCols []int
		for c := range GridSize {
			mask, _, cnt := lineCandidatePositions(b, Cols[c], d)
			if cnt == 2 || cnt == 3 {
				colMasks[c] = mask
				candCols = append(candCols, c)
			}
		}
		for i := range len(candCols) {
			c1 := candCols[i]
			for j := i + 1; j < len(candCols); j++ {
				c2 := candCols[j]
				u12 := colMasks[c1] | colMasks[c2]
				if bits.OnesCount16(u12) > 3 {
					continue
				}
				for k := j + 1; k < len(candCols); k++ {
					c3 := candCols[k]
					rowUnion := u12 | colMasks[c3]
					if bits.OnesCount16(rowUnion) != 3 {
						continue
					}

					var elims []Elimination
					for c := range GridSize {
						if c == c1 || c == c2 || c == c3 {
							continue
						}
						tmp := rowUnion
						for tmp != 0 {
							lsb := tmp & -tmp
							tmp &^= lsb
							r := bits.TrailingZeros16(lsb)
							cellIdx := Cols[c][r]
							if b.Cells[cellIdx].Value == 0 && (b.Cells[cellIdx].Candidates&dMask) != 0 {
								elims = append(elims, Elimination{Cell: cellIdx, Digit: d})
							}
						}
					}
					if len(elims) > 0 {
						sortEliminations(elims)
						var driving []int
						for _, c := range []int{c1, c2, c3} {
							tmp := colMasks[c]
							for tmp != 0 {
								lsb := tmp & -tmp
								tmp &^= lsb
								r := bits.TrailingZeros16(lsb)
								driving = append(driving, Cols[c][r])
							}
						}
						return Step{
							Technique:    TechniqueSwordfish,
							Difficulty:   DifficultyHard,
							Region:       Region{Kind: RegionColumn, Index: c1},
							DrivingCells: sortedUniqueInts(driving...),
							Placements:   []Placement{},
							Eliminations: elims,
						}, true
					}
				}
			}
		}
	}
	return Step{}, false
}
