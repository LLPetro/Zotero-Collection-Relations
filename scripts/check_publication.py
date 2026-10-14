"""Review a clean source export and optional XPI without printing sensitive values."""
from pathlib import Path, PurePosixPath
from zipfile import ZipFile
import argparse
import json
import re
import struct

PRIVATE_PARTS = {'.local', '.codex', '.claude', '.agents', 'archive', 'research', 'manuscript', 'storage', 'node_modules', '__pycache__'}
PRIVATE_NAMES = {'AGENTS.md', 'CLAUDE.md', '.env'}
TEXT_SUFFIXES = {'.js', '.json', '.py', '.sh', '.md', '.xhtml', '.css', '.svg', '.ftl', '.yml', '.yaml'}
PATTERNS = {
    'credential': re.compile(r'(?:gh[pousr]_|github_pat_|sk-(?:proj-)?)[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'personal_path': re.compile(r'/home/[A-Za-z0-9_-]+/|/mnt/[a-z]/Users/[^/\s]+|[A-Z]:\\+Users\\+[^\\\s]+|wsl\.localhost'),
    'library_session': re.compile(r'session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{23,}'),
    'url_credentials': re.compile(r'https?://[^/\s\"\']+:[^/@\s\"\']+@'),
}


def review_bytes(name, content):
    findings = []
    try:
        text = content.decode('utf-8')
    except UnicodeDecodeError:
        return [{'file': name, 'rule': 'unexpected_binary'}]
    for rule, pattern in PATTERNS.items():
        lines = sorted({text.count('\n', 0, match.start()) + 1 for match in pattern.finditer(text)})
        if lines:
            findings.append({'file': name, 'rule': rule, 'lines': lines})
    if name.startswith(('src/', 'ui/')):
        pattern = re.compile(r"(?:itemKey|attachmentKey|annotationKey|key)\s*:\s*[\"']([A-Z2-9]{8})[\"']")
        if pattern.search(text):
            findings.append({'file': name, 'rule': 'hardcoded_library_binding'})
    if name.startswith('tests/fixtures/') and re.search(r'openalex:W\d{8,}', text):
        findings.append({'file': name, 'rule': 'provider_records_in_fixture'})
    return findings


def png_chunks(content):
    if content[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Invalid PNG signature')
    chunks = []
    cursor = 8
    while cursor < len(content):
        size = struct.unpack('>I', content[cursor:cursor+4])[0]
        kind = content[cursor+4:cursor+8].decode('ascii')
        if cursor + 12 + size > len(content):
            raise ValueError('Truncated PNG chunk')
        chunks.append(kind)
        cursor += 12 + size
    return chunks


def review_source(root):
    root = Path(root).resolve()
    findings, count = [], 0
    for path in sorted(root.rglob('*')):
        relative = path.relative_to(root)
        if '.git' in relative.parts:
            continue  # Git metadata is outside the exported source; history needs separate review.
        if path.is_symlink():
            findings.append({'file': str(relative), 'rule': 'symlink'})
            continue
        if not path.is_file():
            continue
        count += 1
        if any(part in PRIVATE_PARTS for part in relative.parts) or path.name in PRIVATE_NAMES or path.name.startswith('.env.'):
            findings.append({'file': str(relative), 'rule': 'private_artifact'})
        if path.suffix.lower() in {'.pdf', '.sqlite', '.db', '.xpi', '.zip', '.log', '.pyc', '.exe'}:
            findings.append({'file': str(relative), 'rule': 'non_source_artifact'})
            continue
        content = path.read_bytes()
        if path.suffix.lower() == '.png':
            try:
                chunks = png_chunks(content)
                if any(chunk not in {'IHDR', 'IDAT', 'IEND', 'sRGB', 'gAMA', 'cHRM', 'PLTE', 'tRNS', 'pHYs'} for chunk in chunks):
                    findings.append({'file': str(relative), 'rule': 'image_metadata_needs_review'})
            except ValueError:
                findings.append({'file': str(relative), 'rule': 'invalid_image'})
        elif path.suffix in TEXT_SUFFIXES or path.name in {'.gitignore', '.editorconfig', '.nvmrc', 'LICENSE'}:
            findings.extend(review_bytes(str(relative), content))
        else:
            findings.append({'file': str(relative), 'rule': 'unexpected_file_type'})
    return {'files': count, 'findings': findings, 'passed': not findings}


def review_xpi(path):
    findings = []
    with ZipFile(path) as archive:
        names = archive.namelist()
        for name in names:
            parts = PurePosixPath(name).parts
            if name.startswith('/') or '..' in parts or not parts:
                findings.append({'file': name, 'rule': 'unsafe_archive_path'})
                continue
            if not (name in {'manifest.json', 'bootstrap.js', 'prefs.js'} or parts[0] in {'src', 'ui', 'icons', 'locale'}):
                findings.append({'file': name, 'rule': 'unexpected_runtime_member'})
            if any(part in PRIVATE_PARTS for part in parts):
                findings.append({'file': name, 'rule': 'private_artifact'})
            findings.extend(review_bytes(name, archive.read(name)))
    return {'files': len(names), 'findings': findings, 'passed': not findings}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path, help='Clean source export, not a personal workspace')
    parser.add_argument('--xpi', type=Path, help='Optional release package to inspect separately')
    args = parser.parse_args()
    result = {'source': review_source(args.source)}
    if args.xpi:
        result['runtime'] = review_xpi(args.xpi)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if all(value['passed'] for value in result.values()) else 1)
