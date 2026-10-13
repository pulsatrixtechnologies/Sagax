import json, os, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "term-guard.py")
DIFF = """diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,3 @@
 keep
+hello Widgetco here
 tail
diff --git a/ok.txt b/ok.txt
--- a/ok.txt
+++ b/ok.txt
@@ -0,0 +1 @@
+clean line
"""


def run(env, diff=None, allow=None, commits=None):
    with tempfile.NamedTemporaryFile("w", delete=False) as f:
        f.write(diff or "")
    e = {"PATH": os.environ["PATH"], "ALLOW_FILE": "/nonexistent", **env}
    extra = []
    if commits is not None:
        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".json") as c:
            json.dump(commits, c)
        extra = ["--commits", c.name]
    if allow is not None:
        with tempfile.NamedTemporaryFile("w", delete=False) as a:
            a.write(allow)
        e["ALLOW_FILE"] = a.name
    p = subprocess.run([sys.executable, SCRIPT, *extra, f.name], env=e, capture_output=True, text=True)
    os.unlink(f.name)
    return p.returncode, p.stdout


class T(unittest.TestCase):
    def test_fail_closed(self):
        self.assertEqual(run({})[0], 2)

    def test_clean(self):
        self.assertEqual(run({"FORBIDDEN_TERMS": "acme\nwidgetco", "PR_TITLE": "ok", "PR_BRANCH": "feat/x"}, "")[0], 0)

    def test_hits_are_located_not_printed(self):
        code, out = run({"FORBIDDEN_TERMS": "WIDGETCO\n", "PR_TITLE": "Add widgetco", "PR_BRANCH": "feat/WidgetCo"}, DIFF)
        self.assertEqual(code, 1)
        self.assertIn("title", out)
        self.assertIn("branch", out)
        self.assertIn("a.txt:2", out)
        self.assertNotIn("ok.txt", out)
        self.assertNotIn("widgetco", out.lower())

    def test_path_hit(self):
        d = "diff --git a/widgetco.txt b/widgetco.txt\n--- /dev/null\n+++ b/widgetco.txt\n@@ -0,0 +1 @@\n+x\n"
        code, out = run({"FORBIDDEN_TERMS": "widgetco"}, d)
        self.assertEqual(code, 1)
        self.assertIn("file #1", out)
        self.assertNotIn("widgetco", out.lower())

    def test_path_allowlist_skips_lines_only(self):
        d = DIFF.replace("a.txt", "src/data/names/list.json")
        code, out = run({"FORBIDDEN_TERMS": "widgetco"}, d, allow="# names\nsrc/data/names/*.json\n")
        self.assertEqual(code, 0, out)
        code, out = run({"FORBIDDEN_TERMS": "widgetco"}, d, allow="other/*\n")
        self.assertEqual(code, 1)
        self.assertIn("src/data/names/list.json:2", out)

    def test_allowlist_does_not_cover_title_branch_or_path(self):
        d = "diff --git a/x/widgetco.json b/x/widgetco.json\n--- /dev/null\n+++ b/x/widgetco.json\n@@ -0,0 +1 @@\n+ok\n"
        code, out = run({"FORBIDDEN_TERMS": "widgetco", "PR_TITLE": "widgetco"}, d, allow="x/*\n")
        self.assertEqual(code, 1)
        self.assertIn("title", out)
        self.assertIn("file #1 path", out)

    def commit(self, email="1+dev@users.noreply.github.com", committer=None, message="fix"):
        return {"sha": "abcdef1234567", "commit": {"message": message,
                "author": {"name": "Dev", "email": email},
                "committer": {"name": "Dev", "email": committer or email}}}

    def test_commit_author_and_committer_email(self):
        code, out = run({"FORBIDDEN_TERMS": "example-corp.test"}, "",
                        commits=[self.commit(email="me@Example-Corp.test", committer="noreply@github.com")])
        self.assertEqual(code, 1)
        self.assertIn("commit abcdef123 author email", out)
        self.assertNotIn("committer email", out)
        self.assertNotIn("example-corp", out.lower())
        code, out = run({"FORBIDDEN_TERMS": "example-corp.test"}, "",
                        commits=[self.commit(committer="me@example-corp.test")])
        self.assertEqual(code, 1)
        self.assertIn("commit abcdef123 committer email", out)

    def test_commit_message_and_clean_commits(self):
        code, out = run({"FORBIDDEN_TERMS": "widgetco"}, "", commits=[self.commit(message="Co-authored-by: x <a@widgetco.io>")])
        self.assertEqual(code, 1)
        self.assertIn("commit abcdef123 message", out)
        self.assertEqual(run({"FORBIDDEN_TERMS": "widgetco"}, "", commits=[self.commit()])[0], 0)

    def test_commits_as_json_lines(self):
        with tempfile.NamedTemporaryFile("w", delete=False, suffix=".jsonl") as c:
            c.write(json.dumps(self.commit()) + "\n" + json.dumps(self.commit(email="x@widgetco.io")) + "\n")
        with tempfile.NamedTemporaryFile("w", delete=False) as f:
            f.write("")
        p = subprocess.run([sys.executable, SCRIPT, "--commits", c.name, f.name],
                           env={"PATH": os.environ["PATH"], "ALLOW_FILE": "/nonexistent", "FORBIDDEN_TERMS": "widgetco"},
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 1, p.stdout)
        self.assertIn("author email", p.stdout)

    def test_regex_term_matches_email_and_domain(self):
        terms = "re:[a-z.]+@example-corp\\.test\nre:\\bexample-corp\\.test\\b"
        d = "diff --git a/c.md b/c.md\n--- a/c.md\n+++ b/c.md\n@@ -0,0 +1 @@\n+mail j.doe@example-corp.test\n"
        code, out = run({"FORBIDDEN_TERMS": terms}, d, commits=[self.commit(email="j.doe@EXAMPLE-CORP.test")])
        self.assertEqual(code, 1, out)
        self.assertIn("c.md:1", out)
        self.assertIn("author email", out)
        self.assertEqual(run({"FORBIDDEN_TERMS": terms}, "", commits=[self.commit()])[0], 0)

    def test_repo_allowlist_has_no_terms(self):
        allow = os.path.join(HERE, "..", "..", ".github", "term-guard-allow-paths.txt")
        terms = [t.strip().lower() for t in os.environ.get("FORBIDDEN_TERMS", "").splitlines() if t.strip() and not t.startswith("#")]
        text = open(allow).read().lower()
        self.assertFalse(any(t in text for t in terms))


if __name__ == "__main__":
    unittest.main()
