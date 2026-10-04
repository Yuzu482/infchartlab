"""Host-independent safety tests for the SPC catalog authoring CLI."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT=Path(__file__).resolve().parents[1]/'tools'/'build-spc-catalog.py'
spec=importlib.util.spec_from_file_location('build_spc_catalog',SCRIPT)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class BuildSpcCatalogSafetyTests(unittest.TestCase):
    def test_atomic_write_replaces_explicit_destination_without_temp_residue(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'catalog.json';target.write_bytes(b'old')
            module.atomic_write(target,b'{"ok":true}\n')
            self.assertEqual(target.read_bytes(),b'{"ok":true}\n')
            self.assertEqual([p.name for p in Path(directory).iterdir()],['catalog.json'])

    def test_pair_publication_rolls_back_first_target_when_second_replace_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            first=Path(directory)/'catalog.json'; second=Path(directory)/'manifest.json'
            first.write_bytes(b'old-catalog'); second.write_bytes(b'old-manifest')
            original=module.os.replace; calls=0
            def fail_second(src,dst):
                nonlocal calls
                calls+=1
                if calls==2: raise OSError('second rename fixture')
                return original(src,dst)
            try:
                module.os.replace=fail_second
                with self.assertRaises(OSError): module.atomic_write_pair(first,b'new-catalog',second,b'new-manifest',True)
            finally: module.os.replace=original
            self.assertEqual(first.read_bytes(),b'old-catalog')
            self.assertEqual(second.read_bytes(),b'old-manifest')
            self.assertEqual(sorted(p.name for p in Path(directory).iterdir()),['catalog.json','manifest.json'])

    def test_failed_temp_write_removes_residual(self):
        with tempfile.TemporaryDirectory() as directory:
            target=Path(directory)/'catalog.json'
            class Broken:
                def __init__(self,fd,*args,**kwargs): self.real=original(fd,*args,**kwargs)
                def __enter__(self): return self
                def __exit__(self,*args): self.real.close(); return False
                def write(self,data): raise OSError('fixture')
                def flush(self): pass
                def fileno(self): return self.real.fileno()
            original=module.os.fdopen
            try:
                module.os.fdopen=lambda fd,*args,**kwargs: Broken(fd,*args,**kwargs)
                with self.assertRaises(OSError): module.atomic_write(target,b'x')
            finally: module.os.fdopen=original
            self.assertEqual(list(Path(directory).iterdir()),[])

if __name__=='__main__': unittest.main()
