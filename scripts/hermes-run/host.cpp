// A small JSI host that runs one JS bundle on the app's own Hermes VM
// (the macOS build in ios/Pods/hermes-engine). Use it to check library
// code on the real engine without the Simulator. See scripts/hermes-run/run.sh.
#include <fstream>
#include <iostream>
#include <sstream>

#include <hermes/hermes.h>
#include <jsi/jsi.h>

using namespace facebook;

int main(int argc, char **argv) {
	if (argc < 2) {
		std::cerr << "usage: hermes-run <bundle.js>\n";
		return 2;
	}
	std::ifstream file(argv[1]);
	std::stringstream source;
	source << file.rdbuf();

	auto config = ::hermes::vm::RuntimeConfig::Builder().withMicrotaskQueue(true).build();
	auto runtime = facebook::hermes::makeHermesRuntime(config);
	jsi::Runtime &rt = *runtime;

	auto print = jsi::Function::createFromHostFunction(
		rt, jsi::PropNameID::forAscii(rt, "print"), 1,
		[](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) {
			for (size_t i = 0; i < count; i++) {
				std::cout << args[i].toString(rt).utf8(rt);
			}
			std::cout << "\n";
			return jsi::Value::undefined();
		});
	rt.global().setProperty(rt, "print", print);

	try {
		rt.evaluateJavaScript(std::make_shared<jsi::StringBuffer>(source.str()), argv[1]);
		rt.drainMicrotasks();
	} catch (const jsi::JSError &error) {
		std::cerr << "JS error: " << error.getMessage() << "\n" << error.getStack() << "\n";
		return 1;
	}
	return 0;
}
