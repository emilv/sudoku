-- Emil Vikström 2013
-- GPL version 3
module Solver (mkPuzzle,
               sudoku, sudoku4, sudoku16,
               solve,
               Template
              ) where

import Data.Array
import Data.Maybe

{- | Known: value, area numbers
     Cell: values, area numbers -}
data Cell = Known { value :: Int   -- ^ The known value of this cell
                  , areas :: [Int] {- ^ Finite list of unique areas the
                                        cell is in -}
                  }
          | Cell { values :: [Int] {- ^ Finite list of unique values
                                        the cell can have -}
                 , areas :: [Int]  {- ^ Finite list of unique areas the
                                        cell is in -}
                 }
          deriving Show
            
-- | Area: List of known values
type Area = [Int]

{- | A collection of numbered areas
     Invariant: Any area may only have unique values -}
type Areas = Array Int Area

{- | A template is a list of cell descriptions,
     where each cell is a tuple of possible values and area ids -}
type Template = [([Int], [Int])]

{- | A collection cells, forming a puzzle
     Invariant: All Known cells with the same area number must have unique
                values -}
type Puzzle = [Cell]

-- | Helper function for calculation of sudoku region membership
region :: Int           -- ^ Side of each region (3 for a 9x9 sudoku)
          -> (Int, Int) -- ^ (x, y') where 'y is y+K in an KxK sudoku
          -> Int        -- ^ Region the cell belongs to
region s (x, y') = let d = s*s
                       y = y' - d
                       rx = ((x-1) `div` s)
                       ry = ((y-1) `div` s)
                   in  rx + ry*s + 1 + {-after x and y regions-} d*2
                       
-- | Template for a 9x9 sudoku
sudoku :: Template
sudoku = [([1..9], [x,y,region 3 (x,y)]) | y <- [10..18], x <- [1..9]]

-- | Template for a 4x4 sudoku
sudoku4 :: Template
sudoku4 = [([1..4], [x,y,region 2 (x,y)]) | y <- [5..8], x <- [1..4]]

-- | Template for a 16x16 sudoku
sudoku16 :: Template
sudoku16 = [([1..16], [x,y,region 4 (x,y)]) | y <- [17..32], x <- [1..16]]

{- | Combine a template and a list of known/unknown values into
     a puzzle to be solved -}
mkPuzzle :: Template -- ^ Template for the puzzle
         -> [Int]    {- ^ List of known cell values (0 if cell is unknown),
                          in same order and number as the template. 
                          Known cells in same area must have unique values -}
         -> Puzzle   -- ^ A puzzle ready to be solved
mkPuzzle t vs = map (\((ps, as), v) ->
                      case v of
                        0 -> Cell{values=ps, areas=as}
                        _ -> Known{value=v, areas=as}) (zip t vs)

-- | Initialise an array of areas for the given collection of cells
mkAreas :: [Cell] -> Areas
mkAreas cs = 
  let arealist = concat [areas c | c <- cs]
      max = maximum arealist
      min = minimum arealist
      init = array (min, max) [(i, []) | i <- [min..max]]
  in  foldl (\as c -> as // [(ai, withCell (as!ai) c) | ai <- areas c]) init cs

-- | Add Known value of cell 'c' to area 'a', just 'a' for unknown values
withCell :: Area -> Cell -> Area
withCell a c@(Known {value=v}) = v:a
withCell a _ = a

-- | Check to see if a value can be set for a cell without violating
-- | the invariant for Areas
canSet :: Areas -> Cell
       -> Int   -- ^ The value to check
       -> Bool  -- ^ Whether the value can be set for the cell
canSet ass Cell{areas=as} v = not . or $ [elem v (ass!a) | a <- as]

-- | Unsafe operation to include 'v' in all areas in 'ass' whose indices
-- | are in 'as' (i.e., v is from here on a known value in 'ass').
-- | Precondition: 'v' is not included in any of the affected areas
set :: Areas -> Cell -> Int -> Areas
set ass Cell{areas=as} v = ass // [(ai, v:(ass!ai)) | ai <- as]

-- | Solve a puzzle
solve :: Puzzle
      -> Maybe [Int] {- ^ One solution to the puzzle, with values in same
                          order as the template used to make it, 
                          or 'Nothing' if there is no solution -}
solve cs = solve' (mkAreas cs) cs

{- | Solve a puzzle by using backtracking. Try a value for a cell, backtrack 
     and try the next value if an impossible position is reached -}
solve' :: Areas       -- ^ Areas in this puzzle, with values found so far
       -> [Cell]      -- ^ Cells left to try
       -> Maybe [Int] -- ^ The first solution found (Nothing if impossible)
solve' as [] = Just []
solve' as (Known {value=v}:cs) = solution v (solve' as cs)
solve' as (c:cs) = let ss = [solution v (solve' (set as c v) cs)
                            | v <- values c, canSet as c v]
                   in  (listToMaybe.catMaybes) ss

-- | Prepend 's' to 'l'
solution :: a -> Maybe [a] -> Maybe [a]
solution _ Nothing = Nothing
solution s (Just l) = Just (s:l)
