# Emil Vikström 2013
# GPL version 3
all: Main.js doc

.PHONY: doc

Main.js: Main.hs Solver.hs
	hastec -O2 --opt-unsafe-ints Main.hs

doc/:
	mkdir doc/

doc: doc/ Solver.hs Main.hs
	haddock -ho doc/ Solver.hs