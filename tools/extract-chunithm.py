"""Read the installed CHUNITHM DLC metadata; never modify game files."""
import argparse, hashlib, json, os, re, sys
from pathlib import Path

IDS = {77: 'disruptorarray', 78: 'kuukansouzou', 79: 'megameteor', 80: 'technopolis', 81: 'yumenohajimari'}
SOURCES = {'SongData': '973b26e63b87bbce1734d51717dd3c0f.bundle', 'PackData': '044c9252e4be3b047295e031faa9fa5c.bundle', 'DynamicStringMapping': 'd08423f4d6ee98d7965e219d186a84bf.bundle', 'DlcRuntimeStartupConfiguration': '2dc2480cff271d9644679447b18f5d70.bundle'}
JACKETS = dict(zip(IDS.values(), ['060f5a5d2c975ac4ebd1a5a50c84173b.bundle', 'c5bde4920a31c60c6ffbe3aeb268601e.bundle', '2aac124b6b33b2a0333a71def2770e4c.bundle', '9eee300877c7d97a9187247d0061a15b.bundle', '4e295cbdff0ed40ac02d17f068a85fa7.bundle']))
def sha(data): return hashlib.sha256(data).hexdigest()
def extract(root, deps, jacket_dir):
    sys.path.insert(0, str(deps))
    import UnityPy
    folder = root / 'infalsus_Data/StreamingAssets/aa/StandaloneWindows64'
    objects, provenance = {}, {}
    for name, filename in SOURCES.items():
        raw = (folder / filename).read_bytes()
        candidates = [o.parse_as_dict() for o in UnityPy.load(raw).objects if o.type.name == 'MonoBehaviour' and o.serialized_type.node]
        matches = [d for d in candidates if d.get('m_Name') == name]
        if len(matches) != 1: raise ValueError('object-identity')
        objects[name] = matches[0]
        provenance[filename] = sha(raw)
    pack = [p for p in objects['PackData']['PackInfo'] if p['Id']['Value'] == 8]
    if len(pack) != 1 or pack[0]['Slug'] != 'dlc-chunithm-0' or {x['Value'] for x in pack[0]['SongIds']} != set(IDS): raise ValueError('pack')
    entries = [e for e in objects['DlcRuntimeStartupConfiguration']['Entries'] if e['DlcId'] == 'dlc-chunithm-0' and e['PackId']['Value'] == 8]
    if len(entries) != 1: raise ValueError('startup')
    mapping = [e for e in entries[0]['StreamingAssets'] if e['FullLookupPath'].endswith('.spc')]
    expected = {b + str(i) + '.spc' for b in IDS.values() for i in range(4)}
    if len(mapping) != 20 or {e['FullLookupPath'] for e in mapping} != expected or len({e['Guid'] for e in mapping}) != 20: raise ValueError('mapping')
    def localized(key, identity):
        m = objects['DynamicStringMapping'][key]
        ix = [i for i, d in enumerate(m['Ids']) if d['Value'] == identity]
        if len(ix) != 1: raise ValueError('localization')
        values = m['IdValues'][ix[0]]
        return next((values.get(lang) for lang in ['SimplifiedChinese', 'English', 'Japanese'] if values.get(lang)), None)
    songs = []
    for identity, basename in IDS.items():
        matches = [s for s in objects['SongData']['allSongInfo'] if s['Id']['Value'] == identity and s['BaseName'] == basename]
        if len(matches) != 1: raise ValueError('song')
        s = matches[0]
        if len(s['ChartInfos']) != 4 or {c['Id'] for c in s['ChartInfos']} != {basename + str(i) for i in range(4)} or any(not c['Available'] for c in s['ChartInfos']): raise ValueError('charts')
        jacket_raw = (folder / JACKETS[basename]).read_bytes()
        provenance[JACKETS[basename]] = sha(jacket_raw)
        textures = [o for o in UnityPy.load(jacket_raw).objects if o.type.name == 'Texture2D' and o.parse_as_dict().get('m_Name') == basename + '_small']
        if len(textures) != 1: raise ValueError('jacket-identity')
        from PIL import Image
        texture = textures[0].read()
        if texture.m_TextureFormat != 25: raise ValueError('jacket-format')
        image = Image.frombytes('RGBA', (texture.m_Width, texture.m_Height), texture.get_image_data(), 'bcn', 7).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        if image.size != (256, 256): raise ValueError('jacket-size')
        import io
        buf = io.BytesIO(); image.save(buf, format='PNG'); png = buf.getvalue()
        atomic_new(jacket_dir / (basename + '.png'), png)
        songs.append({'songId': identity, 'basename': basename, 'title': localized('songIdTitleTypeMapping', identity), 'artist': localized('songIdArtistTypeMapping', identity), 'charts': s['ChartInfos'], 'jacket': {'mime': 'image/png', 'sha256': sha(png), 'width': 256, 'height': 256}})
    for e in mapping:
        if not re.fullmatch('[a-f0-9]{32}', e['Guid']): raise ValueError('guid')
        raw = (root / 'dlc/dlc-chunithm-0/sam' / e['Guid']).read_bytes()
        if len(raw) != e['FileLength'] or len(raw) > 200000: raise ValueError('size')
        e['sha256'] = sha(raw)
    if any(sha((folder / filename).read_bytes()) != provenance[filename] for filename in SOURCES.values()): raise ValueError('source-changed')
    return {'format': 'infalsus-chunithm-metadata-v1', 'source': provenance, 'pack': {'packId': 8, 'slug': 'dlc-chunithm-0', 'label': localized('packIdTypeMapping', 8)}, 'songs': songs, 'mapping': mapping}

def atomic_new(output, data):
    import uuid
    temp = output.with_name(output.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temp.open('xb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
        os.link(temp, output)
    finally:
        temp.unlink(missing_ok=True)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--game-root', required=True); p.add_argument('--deps', required=True); p.add_argument('--output', required=True); p.add_argument('--jacket-dir', required=True)
    a = p.parse_args()
    output, root = Path(a.output).absolute(), Path(a.game_root).resolve()
    project = Path(__file__).resolve().parents[1]
    if output.is_relative_to(project) or output.is_relative_to(root) or not output.parent.is_dir() or output.parent.resolve() != output.parent: raise ValueError('unsafe-output')
    jacket_dir = Path(a.jacket_dir).absolute()
    if jacket_dir.exists() or jacket_dir.is_relative_to(project) or jacket_dir.is_relative_to(root) or not jacket_dir.parent.is_dir() or jacket_dir.parent.resolve() != jacket_dir.parent: raise ValueError('jacket-output')
    jacket_dir.mkdir()
    try:
        data = (json.dumps(extract(root, Path(a.deps), jacket_dir), ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
        atomic_new(output, data)
    except BaseException:
        for path in jacket_dir.iterdir(): path.unlink()
        jacket_dir.rmdir()
        raise
    print(json.dumps({'songs': 5, 'charts': 20, 'metadataSha256': sha(data)}))
if __name__ == '__main__':
    try: main()
    except Exception as e:
        print('extract-failed:' + type(e).__name__, file=sys.stderr); sys.exit(1)
