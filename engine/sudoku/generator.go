package sudoku

import (
	"encoding/binary"
	"errors"
	"fmt"
	"hash/fnv"
	"math/bits"
	"math/rand/v2"
)

const (
	maxGeneratorAttempts = 300
	hardPolishSteps      = 24
)

// PuzzleRecord represents a deterministic, uniquely solvable, graded Sudoku puzzle.
type PuzzleRecord struct {
	ID                 string      `json:"id"`
	Seed               uint64      `json:"seed"`
	EngineVersion      string      `json:"engineVersion"`
	Difficulty         Difficulty  `json:"difficulty"`
	TechniquesRequired []Technique `json:"techniquesRequired"`
	Clues              string      `json:"clues"`
	Solution           string      `json:"solution"`
}

func newLocalRNG(seed uint64, target Difficulty) *rand.Rand {
	h := fnv.New128a()
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], seed)
	_, _ = h.Write(buf[:])
	_, _ = h.Write([]byte{0})
	_, _ = h.Write([]byte(EngineVersion))
	_, _ = h.Write([]byte{0})
	_, _ = h.Write([]byte(target))

	sum := h.Sum(nil)
	s1 := binary.BigEndian.Uint64(sum[:8])
	s2 := binary.BigEndian.Uint64(sum[8:16])
	return rand.New(rand.NewPCG(s1, s2))
}

func generateSolvedGrid(rng *rand.Rand) [BoardSize]uint8 {
	var st dfsState
	fillRandomGrid(&st, rng)
	return st.grid
}

func fillRandomGrid(st *dfsState, rng *rand.Rand) bool {
	bestCell := -1
	bestMask := uint16(0)
	bestCount := GridSize + 1

	for i := range BoardSize {
		if st.grid[i] != 0 {
			continue
		}
		r := RowOf[i]
		c := ColOf[i]
		box := BoxOf[i]
		avail := AllCandidates &^ (st.rowMask[r] | st.colMask[c] | st.boxMask[box])
		cnt := bits.OnesCount16(avail)
		if cnt == 0 {
			return false
		}
		if cnt < bestCount {
			bestCount = cnt
			bestCell = i
			bestMask = avail
			if cnt == 1 {
				break
			}
		}
	}

	if bestCell == -1 {
		return true
	}

	var candidates [GridSize]uint8
	n := 0
	for bestMask != 0 {
		lsb := bestMask & -bestMask
		bestMask &^= lsb
		candidates[n] = uint8(bits.TrailingZeros16(lsb))
		n++
	}
	for i := n - 1; i > 0; i-- {
		j := rng.IntN(i + 1)
		candidates[i], candidates[j] = candidates[j], candidates[i]
	}

	r := RowOf[bestCell]
	c := ColOf[bestCell]
	box := BoxOf[bestCell]
	for i := range n {
		digit := candidates[i]
		mask := DigitMask(digit)
		st.grid[bestCell] = digit
		st.rowMask[r] |= mask
		st.colMask[c] |= mask
		st.boxMask[box] |= mask

		if fillRandomGrid(st, rng) {
			return true
		}

		st.grid[bestCell] = 0
		st.rowMask[r] &^= mask
		st.colMask[c] &^= mask
		st.boxMask[box] &^= mask
	}
	return false
}

func boardFromDigits(digits [BoardSize]uint8) Board {
	b, err := NewBoardFromDigits(digits)
	if err != nil {
		return Board{}
	}
	return b
}

func symmetricGroups(rng *rand.Rand) [][2]int {
	groups := make([][2]int, 0, 41)
	for i := range 40 {
		groups = append(groups, [2]int{i, BoardSize - 1 - i})
	}
	groups = append(groups, [2]int{40, -1})
	for i := len(groups) - 1; i > 0; i-- {
		j := rng.IntN(i + 1)
		groups[i], groups[j] = groups[j], groups[i]
	}
	return groups
}

func shuffledIndices(rng *rand.Rand) [BoardSize]int {
	var indices [BoardSize]int
	for i := range BoardSize {
		indices[i] = i
	}
	for i := BoardSize - 1; i > 0; i-- {
		j := rng.IntN(i + 1)
		indices[i], indices[j] = indices[j], indices[i]
	}
	return indices
}

func digSymmetric(solution [BoardSize]uint8, rng *rand.Rand, target Difficulty) ([BoardSize]uint8, int) {
	puzzle := solution
	clues := BoardSize
	groups := symmetricGroups(rng)

	for _, g := range groups {
		a, b := g[0], g[1]
		va := puzzle[a]
		vb := uint8(0)
		if b >= 0 {
			vb = puzzle[b]
		}
		if va == 0 {
			continue
		}

		puzzle[a] = 0
		removed := 1
		if b >= 0 {
			puzzle[b] = 0
			removed = 2
		}

		candidate := boardFromDigits(puzzle)
		if !candidate.HasUniqueSolution() {
			puzzle[a] = va
			if b >= 0 {
				puzzle[b] = vb
			}
			continue
		}

		if target == DifficultyEasy && clues-removed <= 42 {
			res, err := Grade(&candidate)
			if err != nil || res.Difficulty != DifficultyEasy {
				puzzle[a] = va
				if b >= 0 {
					puzzle[b] = vb
				}
				continue
			}
		}

		clues -= removed
	}

	return puzzle, clues
}

func digAsymmetricUnique(puzzle *[BoardSize]uint8, rng *rand.Rand) {
	indices := shuffledIndices(rng)
	for _, idx := range indices {
		if puzzle[idx] == 0 {
			continue
		}
		saved := puzzle[idx]
		puzzle[idx] = 0
		if !boardFromDigits(*puzzle).HasUniqueSolution() {
			puzzle[idx] = saved
		}
	}
}

func restoreRandomClues(puzzle *[BoardSize]uint8, solution [BoardSize]uint8, count int, rng *rand.Rand) {
	indices := shuffledIndices(rng)
	restored := 0
	for _, idx := range indices {
		if puzzle[idx] == 0 {
			puzzle[idx] = solution[idx]
			restored++
			if restored >= count {
				return
			}
		}
	}
}

func polishToTarget(
	base [BoardSize]uint8,
	solution [BoardSize]uint8,
	rng *rand.Rand,
	target Difficulty,
) ([BoardSize]uint8, GradeResult, bool) {
	puzzle := base
	digAsymmetricUnique(&puzzle, rng)

	for step := range hardPolishSteps {
		board := boardFromDigits(puzzle)
		res, err := Grade(&board)
		if err == nil && res.Difficulty == target {
			return puzzle, res, true
		}

		switch {
		case errors.Is(err, ErrRequiresGuessing):
			// Restore 1 clue to drop from Extreme/guessing into a logical tier.
			restoreRandomClues(&puzzle, solution, 1, rng)
		case err == nil && difficultyRank(res.Difficulty) > difficultyRank(target):
			// Overshot target (e.g., Medium target hit Hard): restore 1-2 clues.
			restoreRandomClues(&puzzle, solution, 1+(step%2), rng)
		default:
			// Undershot target (Easy/Medium when seeking Hard): perturb by restoring 2 clues and re-digging asymmetrically.
			restoreRandomClues(&puzzle, solution, 2, rng)
			digAsymmetricUnique(&puzzle, rng)
		}
	}

	board := boardFromDigits(puzzle)
	res, err := Grade(&board)
	if err == nil && res.Difficulty == target {
		return puzzle, res, true
	}
	return [BoardSize]uint8{}, GradeResult{}, false
}

// Generate deterministically builds a uniquely solvable PuzzleRecord matching target Difficulty
// using a local PCG PRNG seeded solely from (seed, EngineVersion, target).
func Generate(seed uint64, target Difficulty) (PuzzleRecord, error) {
	if target != DifficultyEasy && target != DifficultyMedium && target != DifficultyHard {
		return PuzzleRecord{}, fmt.Errorf("%w: unsupported target difficulty %q", ErrInvalidInput, target)
	}

	rng := newLocalRNG(seed, target)
	puzzleID := fmt.Sprintf("hs-%s-%s-%016x", EngineVersion, target, seed)

	for range maxGeneratorAttempts {
		solution := generateSolvedGrid(rng)
		clues, _ := digSymmetric(solution, rng, target)
		board := boardFromDigits(clues)

		res, err := Grade(&board)
		if err == nil && res.Difficulty == target {
			return PuzzleRecord{
				ID:                 puzzleID,
				Seed:               seed,
				EngineVersion:      EngineVersion,
				Difficulty:         res.Difficulty,
				TechniquesRequired: res.TechniquesRequired,
				Clues:              board.String(),
				Solution:           boardFromDigits(solution).String(),
			}, nil
		}

		if target == DifficultyEasy {
			continue
		}

		if polished, polishedRes, ok := polishToTarget(clues, solution, rng, target); ok {
			polishedBoard := boardFromDigits(polished)
			return PuzzleRecord{
				ID:                 puzzleID,
				Seed:               seed,
				EngineVersion:      EngineVersion,
				Difficulty:         polishedRes.Difficulty,
				TechniquesRequired: polishedRes.TechniquesRequired,
				Clues:              polishedBoard.String(),
				Solution:           boardFromDigits(solution).String(),
			}, nil
		}
	}

	return PuzzleRecord{}, fmt.Errorf("%w: exhausted %d attempts for seed %d (%s)", ErrGenerationFailed, maxGeneratorAttempts, seed, target)
}
