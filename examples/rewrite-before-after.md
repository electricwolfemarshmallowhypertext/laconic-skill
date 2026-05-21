# rewrite-before-after

Before (`fixtures/fail/verbose_recap_heavy.txt`):

```text
Sure, I'd be happy to help.
To recap, you asked for deployment steps.
Use `npm run build` and then run `npm test`.
I hope this helps.
```

Command:

```bash
node dist/cli.js rewrite fixtures/fail/verbose_recap_heavy.txt --receipt
```

After (`final`):

```text
Use `npm run build` and then run `npm test`.
```
