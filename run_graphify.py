import json
import os
import sys
from pathlib import Path

from graphify.detect import detect
from graphify.extract import collect_files, extract
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from graphify.export import to_json, to_html

def main():
    out_dir = Path("graphify-out")
    out_dir.mkdir(exist_ok=True)

    root_path = Path(".").resolve()
    print(f"Detecting files in {root_path}...")
    detection = detect(root_path)
    (out_dir / ".graphify_detect.json").write_text(json.dumps(detection, ensure_ascii=False, indent=2), encoding="utf-8")

    code_files = []
    for f in detection.get('files', {}).get('code', []):
        p = Path(f)
        if p.is_dir():
            code_files.extend(collect_files(p))
        elif p.exists():
            code_files.append(p)

    for ext in ['.ts', '.tsx', '.js', '.jsx']:
        for p in Path('.').glob(f"**/*{ext}"):
            if any(ignored in str(p) for ignored in ['node_modules', '.git', 'dist', 'graphify-out']):
                continue
            if p not in code_files:
                code_files.append(p)

    print(f"Extracting AST for {len(code_files)} source files...")
    ast_result = extract(code_files, cache_root=root_path, parallel=False)
    (out_dir / ".graphify_ast.json").write_text(json.dumps(ast_result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"AST extracted: {len(ast_result['nodes'])} nodes, {len(ast_result['edges'])} edges")

    (out_dir / ".graphify_semantic.json").write_text(json.dumps({'nodes':[], 'edges':[], 'hyperedges':[], 'input_tokens':0, 'output_tokens':0}), encoding='utf-8')

    merged = {
        'nodes': ast_result['nodes'],
        'edges': ast_result['edges'],
        'hyperedges': [],
        'input_tokens': 0,
        'output_tokens': 0,
    }
    (out_dir / ".graphify_extract.json").write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")

    print("Building graph & clustering...")
    G = build_from_json(merged, root=str(root_path), directed=False)
    if G.number_of_nodes() == 0:
        print("Warning: 0 nodes produced.")
        return

    communities = cluster(G)
    cohesion = score_all(G, communities)
    gods = god_nodes(G)
    surprises = surprising_connections(G, communities)
    labels = {cid: f"Module Group {cid}" for cid in communities}

    wrote = to_json(G, communities, str(out_dir / 'graph.json'), community_labels=labels)
    tokens = {'input': 0, 'output': 0}
    questions = suggest_questions(G, communities, labels)
    report = generate(G, communities, cohesion, labels, gods, surprises, detection, tokens, str(root_path), suggested_questions=questions)
    (out_dir / 'GRAPH_REPORT.md').write_text(report, encoding="utf-8")

    print("Exporting interactive graph.html...")
    try:
        to_html(G, communities, str(out_dir / 'graph.html'), community_labels=labels)
        print("Exported graphify-out/graph.html successfully!")
    except Exception as e:
        print(f"to_html notice: {e}")

    print(f"\n✨ Graphify Complete!")
    print(f"- Nodes: {G.number_of_nodes()}")
    print(f"- Edges: {G.number_of_edges()}")
    print(f"- Communities: {len(communities)}")
    print(f"- Interactive Visualizer: {out_dir.resolve() / 'graph.html'}")
    print(f"- Architecture Report: {out_dir.resolve() / 'GRAPH_REPORT.md'}")

if __name__ == '__main__':
    main()
