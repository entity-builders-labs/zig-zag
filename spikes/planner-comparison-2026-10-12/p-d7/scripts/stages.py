"""Tour-level calibration stages (../PROTOCOL.md). Usage: python -I stages.py <stage> ; writes ../runs/<stage>.json"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import calib   # noqa: E402

PROVISIONAL = dict(cd=1, A=10)   # stage 1: smallest grid activation cost with zero short hops in every city


def stage2():
    return calib.run([dict(PROVISIONAL, K=K, name=f'K{K}') for K in (15, 30, 60, 120, 240, 480, 960)], 'stage2_K.json')


def stage2_fine(Ks):
    return calib.run([dict(PROVISIONAL, K=K, name=f'K{K}') for K in Ks], 'stage2_K_fine.json')


def stage3(K):
    grid = [dict(cd=1, A=A, K=K, name=f'A{A}') for A in (0, 5, 10, 15, 20)] + [dict(cd=cd, A=0, K=K, name=f'cd{cd}') for cd in (2, 3, 4)]
    return calib.run(grid, 'stage3_drive.json', profiles=('B',))


def stage3_fine(K):
    return calib.run([dict(cd=1, A=A, K=K, name=f'A{A}') for A in (7, 8, 9, 10, 11, 12, 13)], 'stage3_drive_fine.json', profiles=('B',))


def stage4(base):
    grid = [dict(base, rho=r, name=f'rho{r}') for r in (0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.8)] + \
           [dict(base, P=p, name=f'P{p}') for p in (5, 10, 20, 40, 80)]
    return calib.run(grid, 'stage4_unknown.json')


def stage5(final):
    grid = [dict(final, name='final')]
    for k in ('K', 'A', 'cd', 'rho'):
        for f in (0.5, 0.75, 1.5, 2):
            if final.get(k):
                grid.append(dict(final, **{k: round(final[k] * f, 4)}, name=f'{k}x{f}'))
    return calib.run(grid, 'stage5_sensitivity.json')


def stage5_solver(final):
    return calib.run([dict(final, solutionLimit=n, name=f'SL{n}') for n in (2000, 5000, 10000)], 'stage5_solver.json', workers=6)


def stage6(final):
    return calib.run([dict(final, name='planner-objective-v1')], 'stage6_final.json', profiles=('A', 'B', 'C'),
                     scen=calib.SCEN + ('S1-normal-p20', 'S9-anchors-start-p20', 'S3b-unknown-weight0'), reps=3)


if __name__ == '__main__':
    import json
    st = sys.argv[1]; arg = json.loads(sys.argv[2]) if len(sys.argv) > 2 else None
    {'stage2': lambda: stage2(), 'stage2_fine': lambda: stage2_fine(arg), 'stage3': lambda: stage3(arg),
     'stage3_fine': lambda: stage3_fine(arg), 'stage5_solver': lambda: stage5_solver(arg),
     'stage4': lambda: stage4(arg), 'stage5': lambda: stage5(arg), 'stage6': lambda: stage6(arg)}[st]()
