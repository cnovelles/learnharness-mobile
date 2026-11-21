/**
 * The sort button of the Chains screen (issue 08 slice D): "Name ↑" opens
 * a native iOS menu with Name, Props and Created. A tap on the active
 * column turns the order; a tap on a new column starts at name A to Z, or
 * at the largest or newest first (the desktop `nextChainSort`).
 */
import { Button as MenuItem, Host, Menu } from "@expo/ui/swift-ui";
import { font, foregroundStyle } from "@expo/ui/swift-ui/modifiers";

import { CHAIN_SORT_NAMES, chainSortLabel } from "@/lib/knowledge";
import { nextChainSort, type ChainSort, type ChainSortCol } from "@/lib/shared";
import { FONT, usePalette } from "./ui";

const COLUMNS: readonly ChainSortCol[] = ["name", "props", "created"];

export function ChainSortMenu({
	sort,
	onSort,
}: {
	sort: ChainSort;
	onSort: (sort: ChainSort) => void;
}) {
	const c = usePalette();
	return (
		<Host matchContents>
			<Menu
				label={chainSortLabel(sort)}
				testID="chains-sort"
				modifiers={[foregroundStyle(c.text), font({ family: FONT.ui, size: 12.5 })]}
			>
				{COLUMNS.map((col) => (
					<MenuItem
						key={col}
						label={CHAIN_SORT_NAMES[col]}
						systemImage={
							sort.col === col ? (sort.dir === 1 ? "chevron.up" : "chevron.down") : undefined
						}
						onPress={() => onSort(nextChainSort(sort, col))}
						testID={`chains-sort-${col}`}
					/>
				))}
			</Menu>
		</Host>
	);
}
