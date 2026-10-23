type RunnerRequest = { id: string; code: string };
type RunnerResponse =
  | { id: string; type: "status"; status: "loading" | "running" }
  | { id: string; type: "result"; output: string; error: string | null };

type WorkerScope = {
  addEventListener: (type: "message", listener: (event: MessageEvent<RunnerRequest>) => void) => void;
  postMessage: (message: RunnerResponse) => void;
};

const workerScope = self as unknown as WorkerScope;
const PYODIDE_BASE_URL = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
const PYODIDE_MODULE_URL = `${PYODIDE_BASE_URL}pyodide.mjs`;

const PYTHON_RUNNER_BOOTSTRAP = String.raw`
import ast as _ast
import builtins as _builtins
import io as _io
import json as _json
import sys as _sys

_MAX_CODE = 12000
_MAX_OUTPUT = 6000
_MAX_AST_NODES = 700
_ALLOWED_CALLS = {"print", "int", "float", "str", "type", "len"}
_ALLOWED_METHODS = {"append", "insert", "pop", "index", "count"}
_ALLOWED_NODES = {
    _ast.Module, _ast.Assign, _ast.AugAssign, _ast.Expr, _ast.Name,
    _ast.Load, _ast.Store, _ast.Constant, _ast.Call, _ast.keyword,
    _ast.BinOp, _ast.UnaryOp, _ast.BoolOp, _ast.Compare, _ast.List,
    _ast.Subscript, _ast.Slice, _ast.Attribute, _ast.JoinedStr,
    _ast.FormattedValue, _ast.Add, _ast.Sub, _ast.Mult, _ast.Div,
    _ast.FloorDiv, _ast.Mod, _ast.Pow, _ast.UAdd, _ast.USub, _ast.Not,
    _ast.And, _ast.Or, _ast.Eq, _ast.NotEq, _ast.Lt, _ast.LtE,
    _ast.Gt, _ast.GtE,
}

class _LimitedOutput(_io.StringIO):
    def write(self, value):
        if self.tell() + len(value) > _MAX_OUTPUT:
            raise RuntimeError("출력은 6,000자까지만 표시할 수 있어요.")
        return super().write(value)


def __safe_power(left, right):
    if not isinstance(right, (int, float)) or abs(right) > 1000:
        raise ValueError("거듭제곱 지수는 -1,000에서 1,000 사이로 제한돼요.")
    result = left ** right
    if isinstance(result, int) and result.bit_length() > 100000:
        raise ValueError("계산 결과가 너무 커서 표시할 수 없어요.")
    return result


class _PowerLimiter(_ast.NodeTransformer):
    def visit_BinOp(self, node):
        self.generic_visit(node)
        if isinstance(node.op, _ast.Pow):
            return _ast.copy_location(
                _ast.Call(
                    func=_ast.Name(id="__safe_power", ctx=_ast.Load()),
                    args=[node.left, node.right],
                    keywords=[],
                ),
                node,
            )
        return node


def __run_user_code(code):
    if not isinstance(code, str) or len(code) > _MAX_CODE:
        return {"output": "", "error": "코드는 12,000자 이내로 작성해 주세요."}
    if not code.strip():
        return {"output": "", "error": "먼저 실행할 코드를 작성해 주세요."}

    try:
        tree = _ast.parse(code, filename="solution.py", mode="exec")
    except Exception as error:
        return {"output": "", "error": str(error)}

    nodes = list(_ast.walk(tree))
    if len(nodes) > _MAX_AST_NODES:
        return {"output": "", "error": "코드가 너무 복잡해요. 학습 범위의 짧은 코드로 나누어 실행해 주세요."}

    for node in nodes:
        if type(node) not in _ALLOWED_NODES:
            return {"output": "", "error": "현재 연습 범위에 없는 문법이 포함되어 있어요. 변수, 출력, 연산, 리스트, 슬라이싱을 사용해 주세요."}
        if isinstance(node, _ast.Name) and node.id.startswith("__"):
            return {"output": "", "error": "내부 실행기 이름은 사용할 수 없어요."}
        if isinstance(node, _ast.Constant):
            value = node.value
            if isinstance(value, str) and len(value) > 20000:
                return {"output": "", "error": "문자열은 20,000자 이내로 사용해 주세요."}
            if isinstance(value, (int, float)) and not isinstance(value, bool) and abs(value) > 100000000:
                return {"output": "", "error": "숫자 값이 너무 커요."}
        if isinstance(node, _ast.BinOp) and isinstance(node.op, _ast.Pow):
            if isinstance(node.right, _ast.Constant) and isinstance(node.right.value, (int, float)) and abs(node.right.value) > 1000:
                return {"output": "", "error": "거듭제곱 지수는 -1,000에서 1,000 사이로 제한돼요."}
        if isinstance(node, _ast.FormattedValue) and node.format_spec is not None:
            return {"output": "", "error": "서식 지정 f-string은 아직 실행 범위에 포함되지 않아요."}
        if isinstance(node, _ast.Attribute) and node.attr not in _ALLOWED_METHODS:
            return {"output": "", "error": "현재 연습 범위에서 사용할 수 없는 속성입니다."}
        if isinstance(node, _ast.Call):
            if isinstance(node.func, _ast.Name):
                if node.func.id not in _ALLOWED_CALLS:
                    return {"output": "", "error": "현재 연습 범위에서 사용할 수 없는 함수입니다."}
                keyword_names = {keyword.arg for keyword in node.keywords}
                if node.func.id == "print":
                    if not keyword_names.issubset({"sep", "end"}) or None in keyword_names:
                        return {"output": "", "error": "print()에는 sep와 end만 지정할 수 있어요."}
                elif node.keywords:
                    return {"output": "", "error": "이 함수에는 위치 인수만 사용할 수 있어요."}
            elif isinstance(node.func, _ast.Attribute):
                if node.func.attr not in _ALLOWED_METHODS or node.keywords:
                    return {"output": "", "error": "현재 연습 범위에서 사용할 수 없는 리스트 메서드입니다."}
            else:
                return {"output": "", "error": "현재 연습 범위에서 사용할 수 없는 호출입니다."}

    output = _LimitedOutput()
    previous_stdout = _sys.stdout
    try:
        tree = _PowerLimiter().visit(tree)
        _ast.fix_missing_locations(tree)
        safe_builtins = {name: getattr(_builtins, name) for name in _ALLOWED_CALLS}
        safe_builtins["__safe_power"] = __safe_power
        namespace = {"__builtins__": safe_builtins}
        _sys.stdout = output
        exec(compile(tree, "solution.py", "exec"), namespace, namespace)
        return {"output": output.getvalue(), "error": None}
    except Exception as error:
        return {"output": output.getvalue(), "error": type(error).__name__ + ": " + str(error)}
    finally:
        _sys.stdout = previous_stdout
`;

let pyodidePromise: Promise<any> | null = null;

async function loadPyodideRuntime(): Promise<any> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      const pyodideModule = await import(/* @vite-ignore */ PYODIDE_MODULE_URL);
      const runtime = await pyodideModule.loadPyodide({
        indexURL: PYODIDE_BASE_URL,
        stdout: () => undefined,
        stderr: () => undefined,
      });
      await runtime.runPythonAsync(PYTHON_RUNNER_BOOTSTRAP);
      return runtime;
    })();
  }
  return pyodidePromise;
}

workerScope.addEventListener("message", async (event) => {
  const { id, code } = event.data;
  workerScope.postMessage({ id, type: "status", status: "loading" });

  try {
    const runtime = await loadPyodideRuntime();
    workerScope.postMessage({ id, type: "status", status: "running" });
    const runner = runtime.globals.get("__run_user_code");
    let result: any;
    try {
      result = runner(code);
      const payload = result.toJs({ dict_converter: Object.fromEntries }) as { output: string; error: string | null };
      workerScope.postMessage({ id, type: "result", output: payload.output ?? "", error: payload.error ?? null });
    } finally {
      result?.destroy?.();
      runner?.destroy?.();
    }
  } catch (error) {
    workerScope.postMessage({
      id,
      type: "result",
      output: "",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
