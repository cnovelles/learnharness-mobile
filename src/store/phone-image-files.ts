/**
 * The phone's image folder: `<documents>/local-store/images/`, through the
 * sync File API of `expo-file-system`.
 */
import { Directory, File, Paths } from "expo-file-system";

import type { ImageFiles } from "./image-files";

export function phoneImageFiles(): ImageFiles {
	const folder = new Directory(Paths.document, "local-store", "images");
	return {
		write(name, base64) {
			if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
			const file = new File(folder, name);
			if (!file.exists) file.create();
			file.writeSync(base64, { encoding: "base64" });
		},
		read(name) {
			const file = new File(folder, name);
			return file.exists ? file.base64Sync() : null;
		},
		remove(name) {
			const file = new File(folder, name);
			if (file.exists) file.delete();
		},
	};
}
