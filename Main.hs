-- Emil Vikström 2013
-- GPL version 3
-- | Main GUI for a sudoku puzzle solver. To be compiled with Haste
module Main (main) where

import Haste
import Haste.DOM
import qualified Solver
import Data.List
import Data.Maybe

type Puzzle = ( String          -- | Human-friendly name of the puzzle
              , Solver.Template -- | Backend template for this puzzle
              , Int             -- | Number of input fields
              , Elem -> IO ()   {- | Function that adds GUI components to
                                     the Elem parameter. Precondition: 
                                     the parameter is a table element -}
              )

-- | All puzzles in this solver!
puzzles :: [Puzzle]
puzzles = [("Sudoku (9x9)", Solver.sudoku, 81,
            (\p -> mapM_ (row 3 p) (split 9 [1..81]))),
           ("Sudoku (4x4)", Solver.sudoku4, 16,
            (\p -> mapM_ (row 2 p) (split 4 [1..16]))),
           ("Sudoku (16x16) (slow!)", Solver.sudoku16, 256,
            (\p -> mapM_ (row 4 p) (split 16 [1..256])))
          ]


-- | A sudoku solver!
main :: IO ()
main = do createSelector $ zip [0..] puzzles
          return ()

-- | Add options to selector of puzzle types
createSelector :: [(Int, Puzzle)] -> IO ()
createSelector pz = do mapM_ addOption pz
                       Just selector <- elemById "selector"
                       setCallback selector OnChange
                         (do v <- getProp selector "value"
                             createPuzzle $ puzzles !! (strToInt v))
                       return ()

-- | Add a single option to the selector of puzzle types
addOption :: (Int, Puzzle) -> IO ()
addOption (id, p@(name, tpl, n, cf)) = do c <- newElem "option"
                                          Just parent <- elemById "selector"
                                          setProp c "label" name
                                          setProp c "value" $ show_ id
                                          addChild c parent

{- | Paint a puzzle, including control buttons. Removes any previous puzzle
     first. -}
createPuzzle :: Puzzle -> IO ()
createPuzzle p@(_, _, _, f) = do Just puzzle <- elemById "puzzle"
                                 Just controls <- elemById "controls"
                                 clearChildren puzzle
                                 f puzzle
                                 createControls p
                                 return ()

{- | Paint the control buttons to solve and reset a puzzle.
     Removes control buttons first. -}
createControls :: Puzzle -> IO ()
createControls p@(_, t, n, _) = do Just controls <- elemById "controls"
                                   clearChildren controls
                                   solve <- button "Solve"
                                   reset <- button "Reset"
                                   setCallback solve OnClick
                                     (\_ -> do l <- readAll n
                                               showSolution n
                                                 (Solver.solve
                                                  (Solver.mkPuzzle t
                                                   l)))
                                   setCallback reset OnClick
                                     (\_ -> createPuzzle p)
                                   return ()
  where {- | Create a button element with label 'label', add it to "controls"
             and return it. -}
        button :: String -> IO Elem
        button label = do Just controls <- elemById "controls"
                          b <- newElem "input"
                          setProp b "type" "button"
                          setProp b "value" label
                          addChild b controls
                          return b


-- | Show a solution to a puzzle, or alert if none exists
showSolution :: Int         -- ^ Number of fields
             -> Maybe [Int] -- ^ List of cell values in same order as fields
             -> IO ()
showSolution _ Nothing = do alert $ "No solution!"
showSolution n (Just ss) = do mapM_ (\(i, v) -> showOne i v) (zip [1..n] ss)

-- | Fill in one field of the solution
showOne :: Int -> Int -> IO ()
showOne id value = do Just e <- elemById ("i"++(show_ id))
                      setProp e "value" (show_ value)

-- | Convert string to integer
strToInt :: String -> Int
strToInt "" = 0
strToInt x = read x

-- | Read the first 'n' field values
readAll :: Int -> IO [Int]
readAll n = do mapM (\x -> x) [readOne id | id <- [1..n]]

-- | Read value of field 'id'
readOne :: Int -> IO Int
readOne id = do Just e <- elemById ("i"++(show_ id))
                s <- getProp e "value"
                return $ strToInt s

-- | Split a list 'l' into subparts of length 'n'
split :: Int -> [a] -> [[a]]
split _ [] = []
split n l = let (h, t) = splitAt n l
            in  h : split n t

-- | Add a table row into the GUI, in a sudoku puzzle
row :: Int   -- ^ Width in cells of one region in the sudoku (3 for 9x9 sudoku)
    -> Elem  -- ^ Parent element (the table) for the row
    -> [Int] -- ^ Field ids to add
    -> IO ()
row s p ids = do tr <- newElem "tr"
                 mapM_ (field (sudokuClassFunction s) tr) ids
                 addChild tr p

-- | Add a single field to the GUI
field :: (Int -> String) {- ^ Given the 'id' gives a string of style
                              classes to add to the table cell (td) -}
      -> Elem            -- ^ Parent element (tr)
      -> Int             -- ^ 'id' of the field
      -> IO ()
field classes tr id =
   do input <- newElem "input"
      td <- newElem "td"
      setProp input "id" ("i" ++ (show_ id))
      setProp td "className" (classes id)
      addChild input td
      addChild td tr

-- | Calculate style classes for the table cell (td) for field id     
sudokuClassFunction :: Int    -- | Width of a region (3 for 9x9 sudoku)
                    -> Int    -- | 'id' of field
                    -> String -- | Style classes
sudokuClassFunction s id = 
  let n = s*s
      x = ((id - 1) `mod` n) + 1
      y = ((id - 1) `div` n) + 1
      -- | Classes should be added for right and bottom borders
      -- | of a region, if the cell is on the corresponding edge
      if36 :: Int      -- ^ Coordinate on x or y axis
           -> String   -- ^ Class to add if right/bottom
           -> [String] -- ^ The class if right/bottom, empty list otherwise
      if36 x cl = (if x < n && x `mod` s == 0 then [cl] else [])
  in  intercalate " " (["cell"] ++ (if36 x "r") ++ (if36 y "d"))